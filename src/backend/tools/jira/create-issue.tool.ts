import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";

export const CreateIssueInputSchema = z.object({
  projectKey: z.string().min(1, "Project key is required"),
  summary: z.string().min(1, "Summary is required"),
  issueType: z.string().default("Task"),
  description: z.string().optional(),
});

export type CreateIssueInput = z.infer<typeof CreateIssueInputSchema>;

export type CreateIssueToolDeps = {
  jiraService: {
    createIssue(
      projectKey: string,
      summary: string,
      issueType: string,
      description?: string
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

export function registerCreateIssueTool(
  server: McpServer,
  deps: CreateIssueToolDeps
): void {
  server.tool(
    "jira_create_issue",
    "Create a new Jira issue",
    CreateIssueInputSchema.shape,
    async (args) => {
      try {
        const input = CreateIssueInputSchema.parse(args);
        deps.logger.info("Creating Jira issue", { projectKey: input.projectKey });

        const result = await deps.jiraService.createIssue(
          input.projectKey,
          input.summary,
          input.issueType,
          input.description
        );

        if (isErr(result)) {
          const errorMsg = `Failed to create Jira issue: ${result.error.message}`;
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
              text: `Error creating Jira issue: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
