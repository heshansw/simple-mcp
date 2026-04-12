import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";
import {
  JiraAssignIssueInputObjectSchema,
  JiraAssignIssueInputSchema,
} from "@shared/schemas/jira.schema.js";
import type { JiraAssignIssueParams } from "../../services/jira.service.js";
import { createValidationErrorResponse, type ToolLogger } from "./tool-shared.js";

export type AssignIssueToolDeps = {
  jiraService: {
    assignIssue(params: JiraAssignIssueParams): Promise<Result<unknown, DomainError>>;
  };
  logger: ToolLogger;
};

export function registerAssignIssueTool(
  server: McpServer,
  deps: AssignIssueToolDeps
): void {
  server.tool(
    "jira_assign_issue",
    "Assign or unassign a Jira issue using an account ID, query, display name, or email address.",
    JiraAssignIssueInputObjectSchema.shape,
    async (args: unknown) => {
      const parsed = JiraAssignIssueInputSchema.safeParse(args);
      if (!parsed.success) {
        return createValidationErrorResponse(parsed.error);
      }

      try {
        const input = {
          issueKey: parsed.data.issueKey,
          ...(parsed.data.assigneeAccountId !== undefined ? { assigneeAccountId: parsed.data.assigneeAccountId } : {}),
          ...(parsed.data.assigneeQuery !== undefined ? { assigneeQuery: parsed.data.assigneeQuery } : {}),
          ...(parsed.data.assigneeDisplayName !== undefined ? { assigneeDisplayName: parsed.data.assigneeDisplayName } : {}),
          ...(parsed.data.assigneeEmailAddress !== undefined ? { assigneeEmailAddress: parsed.data.assigneeEmailAddress } : {}),
          ...(parsed.data.unassign !== undefined ? { unassign: parsed.data.unassign } : {}),
        };
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
