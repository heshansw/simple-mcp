import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  PublishConsolidatedReviewInputSchema,
} from "@shared/schemas/review-session.schema.js";
import type { GitHubService } from "../../services/github.service.js";
import type { ReviewsRepository } from "../../db/repositories/reviews.repository.js";
import type { ReviewSessionsRepository } from "../../db/repositories/review-sessions.repository.js";
import { isErr, domainErrorMessage } from "@shared/result.js";

export type PublishConsolidatedReviewToolDeps = {
  githubService: GitHubService;
  reviewsRepo: ReviewsRepository;
  reviewSessionsRepo: ReviewSessionsRepository;
  logger: {
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerPublishConsolidatedReviewTool(
  server: McpServer,
  deps: PublishConsolidatedReviewToolDeps
): void {
  server.registerTool(
    "publish_consolidated_review",
    {
      title: "Publish Consolidated Review",
      description:
        "Post a single consolidated GitHub review with merged findings from all agent drafts. " +
        "Called by the review-synthesiser agent after deduplicating and merging draft reviews. " +
        "Comments with invalid positions (<=0) are silently dropped.",
      inputSchema: PublishConsolidatedReviewInputSchema,
    },
    async (args) => {
      try {
        const input = PublishConsolidatedReviewInputSchema.parse(args);

        // Validate session
        const session = await deps.reviewSessionsRepo.findById(input.sessionId);
        if (!session) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "Session not found", sessionId: input.sessionId }),
              },
            ],
            isError: true,
          };
        }

        if (session.status === "completed" || session.status === "failed") {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "Session is already closed",
                  sessionId: input.sessionId,
                }),
              },
            ],
            isError: true,
          };
        }

        // Transition to synthesising if currently reviewing
        if (session.status === "reviewing") {
          await deps.reviewSessionsRepo.updateStatus(input.sessionId, "synthesising");
        }

        // Filter out comments with position <= 0
        const validComments = input.comments.filter((c) => c.position > 0);
        const commentsDropped = input.comments.length - validComments.length;

        if (commentsDropped > 0) {
          deps.logger.warn(
            { sessionId: input.sessionId, commentsDropped },
            "Dropped comments with invalid positions (<=0)"
          );
        }

        // Post review to GitHub
        const reviewResult = await deps.githubService.reviewPullRequest({
          owner: input.owner,
          repo: input.repo,
          prNumber: input.prNumber,
          body: input.body,
          event: input.verdict,
          comments: validComments.map((c) => ({
            path: c.path,
            position: c.position,
            body: c.body,
          })),
        });

        if (isErr(reviewResult)) {
          // Mark session as failed
          const sanitisedMessage = "Failed to post review to GitHub";
          await deps.reviewSessionsRepo.updateStatus(
            input.sessionId,
            "failed",
            domainErrorMessage(reviewResult.error)
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: sanitisedMessage,
                  sessionId: input.sessionId,
                }),
              },
            ],
            isError: true,
          };
        }

        const review = reviewResult.value;

        // Mark session as completed
        await deps.reviewSessionsRepo.updateStatus(input.sessionId, "completed");

        // Persist to reviews table for dashboard visibility
        try {
          await deps.reviewsRepo.createCompleted({
            owner: input.owner,
            repo: input.repo,
            prNumber: input.prNumber,
            prTitle: "",
            prAuthor: "",
            verdict: input.verdict,
            inlineCommentCount: validComments.length,
            reviewBody: input.body,
            filesChanged: 0,
            additions: 0,
            deletions: 0,
            githubReviewId: review.id,
            githubReviewUrl: review.html_url,
            inputTokensEstimate: null,
            outputTokensEstimate: null,
            completedAt: new Date().toISOString(),
          });
        } catch (dbErr) {
          deps.logger.error({ error: dbErr }, "Failed to persist consolidated review to DB");
        }

        const result = {
          sessionId: input.sessionId,
          githubReviewId: review.id,
          githubReviewUrl: review.html_url,
          verdict: input.verdict,
          inlineCommentsPosted: validComments.length,
          commentsDropped,
        };

        deps.logger.info(
          {
            sessionId: input.sessionId,
            githubReviewId: review.id,
            inlineCommentsPosted: validComments.length,
            commentsDropped,
          },
          "Consolidated review published"
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );
}
