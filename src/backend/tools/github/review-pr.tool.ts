import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubService } from "../../services/github.service.js";
import type { ReviewsRepository } from "../../db/repositories/reviews.repository.js";
import { isErr, domainErrorMessage } from "@shared/result.js";

const InlineCommentSchema = z.object({
  path: z.string().min(1).describe("File path relative to repo root (e.g. 'src/index.ts')"),
  position: z
    .number()
    .int()
    .positive()
    .describe(
      "Line position in the diff hunk (not the file line number). " +
      "Count from the top of the file's diff patch, starting at 1, " +
      "including context lines, additions (+), and deletions (-)."
    ),
  body: z.string().min(1).describe("The review comment for this specific line"),
});

export const SubmitReviewInputSchema = z.object({
  owner: z.string().min(1).describe("Repository owner (e.g. 'octocat')"),
  repo: z.string().min(1).describe("Repository name (e.g. 'hello-world')"),
  prNumber: z
    .number()
    .int()
    .positive()
    .describe("Pull request number to review"),
  prTitle: z
    .string()
    .optional()
    .describe("Pull request title (from github_get_pr_diff). Used for tracking."),
  body: z
    .string()
    .min(1)
    .describe("Overall review summary. Include your assessment of the PR quality, key findings, and recommendations."),
  event: z
    .enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"])
    .describe(
      "Review verdict: APPROVE if the PR looks good, REQUEST_CHANGES if there are issues " +
      "that must be fixed before merging, COMMENT for general feedback without blocking."
    ),
  comments: z
    .array(InlineCommentSchema)
    .optional()
    .describe(
      "Inline comments on specific lines in the diff. Each comment targets a specific file " +
      "and position in the diff. Use github_get_pr_diff first to see the diffs and determine positions."
    ),
  connectionName: z
    .string()
    .optional()
    .describe(
      'Optional: name of the GitHub connection to submit as (e.g. "Codex (Local)"). ' +
      "If omitted, uses the default GitHub connection."
    ),
  inputTokensEstimate: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Your estimate of input tokens consumed reading the PR diff (rough: diff character count ÷ 4)."
    ),
  outputTokensEstimate: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "Your estimate of output tokens used writing this review (rough: review body character count ÷ 4)."
    ),
});

export type SubmitReviewInput = z.infer<typeof SubmitReviewInputSchema>;

export type ReviewPrToolDeps = {
  githubService: GitHubService;
  reviewsRepo: ReviewsRepository;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerReviewPrTool(
  server: McpServer,
  deps: ReviewPrToolDeps
): void {
  server.registerTool(
    "github_submit_review",
    {
      title: "Submit PR Review",
      description:
        "Submit a code review on a GitHub pull request with an overall summary and optional " +
        "inline comments on specific lines. Use github_get_pr_diff first to fetch the PR " +
        "diff, analyze the code, then use this tool to post your review with specific feedback " +
        "on individual files and lines.",
      inputSchema: SubmitReviewInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const input = SubmitReviewInputSchema.parse(args);

        const reviewParams = {
          owner: input.owner,
          repo: input.repo,
          prNumber: input.prNumber,
          body: input.body,
          event: input.event,
          comments: input.comments?.map((c) => ({
            path: c.path,
            position: c.position,
            body: c.body,
          })),
        };

        const result = input.connectionName
          ? await deps.githubService.reviewPullRequestAs(reviewParams, input.connectionName)
          : await deps.githubService.reviewPullRequest(reviewParams);

        if (isErr(result)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to submit review: ${domainErrorMessage(result.error)}. ` +
                  "If inline comments failed, check that the file paths and diff positions are correct. " +
                  "Positions must reference lines in the diff, not the file itself.",
              },
            ],
            isError: true,
          };
        }

        const review = result.value;
        const commentCount = input.comments?.length ?? 0;

        // Estimate tokens from content length if not provided
        const outputTokensEstimate =
          input.outputTokensEstimate ?? Math.ceil(input.body.length / 4);

        // Persist the review: complete an existing in-progress row, or create a new completed row
        try {
          const completed = await deps.reviewsRepo.completeReview(
            input.owner,
            input.repo,
            input.prNumber,
            {
              verdict: input.event,
              inlineCommentCount: commentCount,
              reviewBody: input.body,
              githubReviewId: review.id,
              githubReviewUrl: review.html_url,
              outputTokensEstimate,
            }
          );

          // If no in-progress row existed, create a completed one from scratch
          if (!completed) {
            await deps.reviewsRepo.createCompleted({
              owner: input.owner,
              repo: input.repo,
              prNumber: input.prNumber,
              prTitle: input.prTitle ?? "",
              prAuthor: "",
              verdict: input.event,
              inlineCommentCount: commentCount,
              reviewBody: input.body,
              filesChanged: 0,
              additions: 0,
              deletions: 0,
              githubReviewId: review.id,
              githubReviewUrl: review.html_url,
              inputTokensEstimate: input.inputTokensEstimate ?? null,
              outputTokensEstimate,
              completedAt: new Date().toISOString(),
            });
          }
        } catch (dbErr) {
          // Don't fail the tool call if DB write fails — the review was already posted
          deps.logger.error({ error: dbErr }, "Failed to persist review to DB");
        }

        deps.logger.info(
          {
            owner: input.owner,
            repo: input.repo,
            prNumber: input.prNumber,
            event: input.event,
            inlineComments: commentCount,
            outputTokensEstimate,
          },
          "PR review submitted via MCP tool"
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Review submitted successfully!`,
                `  Review ID: ${review.id}`,
                `  State: ${review.state}`,
                `  Event: ${input.event}`,
                `  Inline comments: ${commentCount}`,
                `  URL: ${review.html_url}`,
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error submitting review: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
