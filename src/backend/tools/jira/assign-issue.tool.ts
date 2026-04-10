import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";
import { JiraAssignIssueInputSchema } from "@shared/schemas/jira.schema.js";
import type { JiraAssignIssueParams } from "../../services/jira.service.js";

export type AssignIssueToolDeps = {
  jiraService: {
    assignIssue(params: JiraAssignIssueParams): Promise<Result<unknown, DomainError>>;
  };
  connectionManager: {
    getConnection(integrationName: string): unknown;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

const AssignIssueInputObjectSchema = z.object({
  issueKey: z.string().min(1, "Issue key is required"),
  assigneeAccountId: z.string().min(1).optional(),
  assigneeQuery: z.string().min(1).optional(),
  assigneeDisplayName: z.string().min(1).optional(),
  assigneeEmailAddress: z.string().email().optional(),
  unassign: z.boolean().default(false),
});

export function registerAssignIssueTool(
  server: McpServer,
  deps: AssignIssueToolDeps
): void {
  server.tool(
    "jira_assign_issue",
    "Assign or unassign a Jira issue using an account ID, query, display name, or email address.",
    AssignIssueInputObjectSchema.shape,
    async (args: unknown) => {
      try {
        const input = JiraAssignIssueInputSchema.parse(args);
        deps.logger.info("Assigning Jira issue", { issueKey: input.issueKey });

        const result = await deps.jiraService.assignIssue(input);

        if (isErr(result)) {
          const errorMsg = `Failed to assign Jira issue: ${"message" in result.error ? result.error.message : String(result.error)}`;
          deps.logger.error(errorMsg);
          return {
            content: [{ type: "text" as const, text: errorMsg }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error assigning Jira issue: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
