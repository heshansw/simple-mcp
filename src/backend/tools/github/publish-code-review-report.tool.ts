import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  PublishCodeReviewReportInputSchema,
} from "@shared/schemas/code-review.schema.js";
import type { CodeReviewSessionsRepository } from "../../db/repositories/code-review-sessions.repository.js";

export type PublishCodeReviewReportToolDeps = {
  codeReviewSessionsRepo: CodeReviewSessionsRepository;
  adminPort: number;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerPublishCodeReviewReportTool(
  server: McpServer,
  deps: PublishCodeReviewReportToolDeps
): void {
  server.registerTool(
    "publish_code_review_report",
    {
      title: "Publish Code Review Report",
      description:
        "Called by the review-synthesiser agent after merging all code review drafts. " +
        "Stores the consolidated report markdown and marks the session as completed. " +
        "Returns the full report for terminal display.",
      inputSchema: PublishCodeReviewReportInputSchema,
    },
    async (args) => {
      try {
        const input = PublishCodeReviewReportInputSchema.parse(args);

        // Validate session exists
        const session = await deps.codeReviewSessionsRepo.findById(input.codeReviewSessionId);
        if (!session) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "Code review session not found.",
                  codeReviewSessionId: input.codeReviewSessionId,
                }),
              },
            ],
            isError: true,
          };
        }

        // Validate session is not closed
        if (session.status === "completed" || session.status === "failed") {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "Session is already closed.",
                  codeReviewSessionId: input.codeReviewSessionId,
                }),
              },
            ],
            isError: true,
          };
        }

        // Generate report URL
        const port = deps.adminPort || 3000;
        const reportUrl = `http://localhost:${port}/code-reviews/${input.codeReviewSessionId}`;

        // Complete the session in a single update (status + report + url + completedAt)
        const completedAt = new Date().toISOString();
        try {
          await deps.codeReviewSessionsRepo.completeSession(input.codeReviewSessionId, {
            reportMarkdown: input.reportMarkdown,
            reportUrl,
            completedAt,
          });
        } catch (dbErr) {
          deps.logger.error({ error: dbErr }, "Failed to complete code review session");
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "Database error. Please try again.",
                  codeReviewSessionId: input.codeReviewSessionId,
                }),
              },
            ],
            isError: true,
          };
        }

        const result = {
          codeReviewSessionId: input.codeReviewSessionId,
          reportUrl,
          verdict: input.verdict,
          reportMarkdown: input.reportMarkdown,
        };

        deps.logger.info(
          {
            codeReviewSessionId: input.codeReviewSessionId,
            verdict: input.verdict,
            reportUrl,
          },
          "Code review report published"
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
