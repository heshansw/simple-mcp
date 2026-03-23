import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";

export const GetCommentsInputSchema = z.object({
  issueKey: z.string().min(1, "Issue key is required"),
  startAt: z.number().int().nonnegative().default(0),
  maxResults: z.number().int().positive().max(100).default(50),
});

export type GetCommentsInput = z.infer<typeof GetCommentsInputSchema>;

export type GetCommentsToolDeps = {
  jiraService: {
    getIssueComments(
      issueKey: string,
      startAt?: number,
      maxResults?: number
    ): Promise<Result<unknown, DomainError>>;
  };
  connectionManager: {
    getConnection(integrationName: string): unknown;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerGetCommentsTool(
  server: McpServer,
  deps: GetCommentsToolDeps
): void {
  server.tool(
    "jira_get_comments",
    "Get comments on a Jira issue",
    GetCommentsInputSchema.shape,
    async (args) => {
      try {
        const input = GetCommentsInputSchema.parse(args);
        deps.logger.info("Fetching Jira issue comments", {
          issueKey: input.issueKey,
        });

        const result = await deps.jiraService.getIssueComments(
          input.issueKey,
          input.startAt,
          input.maxResults
        );

        if (isErr(result)) {
          const errorMsg = `Failed to get comments: ${"message" in result.error ? result.error.message : String(result.error)}`;
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
              text: `Error fetching Jira comments: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
