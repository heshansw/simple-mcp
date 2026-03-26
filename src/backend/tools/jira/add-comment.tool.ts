import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";

export const AddCommentInputSchema = z.object({
  issueKey: z.string().min(1, "Issue key is required"),
  body: z.string().min(1, "Comment body cannot be empty").describe(
    "Comment body in markdown format. Supports: headings (#), bullet lists (- or *), ordered lists (1.), code blocks (```lang), blockquotes (>), inline **bold**, *italic*, ~~strikethrough~~, `code`, [links](url). Automatically converted to Jira's ADF format."
  ),
});

export type AddCommentInput = z.infer<typeof AddCommentInputSchema>;

export type AddCommentToolDeps = {
  jiraService: {
    addComment(
      issueKey: string,
      body: string
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

export function registerAddCommentTool(
  server: McpServer,
  deps: AddCommentToolDeps
): void {
  server.tool(
    "jira_add_comment",
    "Add a comment to a Jira issue. The body accepts markdown which is automatically converted to Jira's Atlassian Document Format (ADF) — supports headings, lists, code blocks, bold, italic, links, and more.",
    AddCommentInputSchema.shape,
    async (args) => {
      try {
        const input = AddCommentInputSchema.parse(args);
        deps.logger.info("Adding comment to Jira issue", {
          issueKey: input.issueKey,
        });

        const result = await deps.jiraService.addComment(
          input.issueKey,
          input.body
        );

        if (isErr(result)) {
          const errorMsg = `Failed to add comment: ${"message" in result.error ? result.error.message : String(result.error)}`;
          deps.logger.error(errorMsg);
          return {
            content: [{ type: "text" as const, text: errorMsg }],
            isError: true,
          };
        }

        const successText = JSON.stringify(
          { success: true, result: result.value },
          null,
          2
        );
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
              text: `Error adding comment to Jira issue: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
