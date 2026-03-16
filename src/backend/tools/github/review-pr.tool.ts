import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";

export const ReviewPrInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  prNumber: z
    .number()
    .int("PR number must be an integer")
    .positive("PR number must be positive"),
  body: z.string().min(1, "Review body is required"),
  event: z
    .enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"])
    .describe("Review event type"),
});

export type ReviewPrInput = z.infer<typeof ReviewPrInputSchema>;

export type ReviewPrToolDeps = {
  githubService: {
    reviewPullRequest(
      owner: string,
      repo: string,
      prNumber: number,
      body: string,
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT"
    ): Promise<
      | { _tag: "Ok"; value: unknown }
      | { _tag: "Err"; error: { _tag: string; message: string } }
    >;
  };
  connectionManager: {
    getConnection(integrationName: string): unknown;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerReviewPrTool(
  server: McpServer,
  deps: ReviewPrToolDeps
): void {
  server.tool(
    "github_review_pr",
    "Submit a review on a GitHub pull request",
    ReviewPrInputSchema.shape,
    async (args) => {
      try {
        const input = ReviewPrInputSchema.parse(args);
        deps.logger.info("Submitting GitHub PR review", {
          owner: input.owner,
          repo: input.repo,
          prNumber: input.prNumber,
          event: input.event,
        });

        const result = await deps.githubService.reviewPullRequest(
          input.owner,
          input.repo,
          input.prNumber,
          input.body,
          input.event
        );

        if (isErr(result)) {
          const errorMsg = `Failed to submit GitHub PR review: ${result.error.message}`;
          deps.logger.error(errorMsg);
          return {
            content: [{ type: "text" as const, text: errorMsg }],
            isError: true,
          };
        }

        const successText = JSON.stringify(result.value, null, 2);
        return {
          content: [{ type: "text" as const, text: successText }],
        };
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error submitting GitHub PR review: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
