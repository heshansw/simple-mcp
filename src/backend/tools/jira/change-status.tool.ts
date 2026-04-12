import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";
import {
  JiraChangeStatusInputObjectSchema,
  JiraChangeStatusInputSchema,
} from "@shared/schemas/jira.schema.js";
import { createValidationErrorResponse, type ToolLogger } from "./tool-shared.js";

export type ChangeStatusToolDeps = {
  jiraService: {
    changeIssueStatus(
      issueKey: string,
      targetStatusName: string
    ): Promise<Result<unknown, DomainError>>;
  };
  logger: ToolLogger;
};

export function registerChangeStatusTool(
  server: McpServer,
  deps: ChangeStatusToolDeps
): void {
  server.tool(
    "jira_change_status",
    "Change a Jira issue status by status name. Use this when you know the target status but not the transition ID.",
    JiraChangeStatusInputObjectSchema.shape,
    async (args: unknown) => {
      const parsed = JiraChangeStatusInputSchema.safeParse(args);
      if (!parsed.success) {
        return createValidationErrorResponse(parsed.error);
      }

      try {
        const input = parsed.data;
        deps.logger.info("Changing Jira issue status", {
          issueKey: input.issueKey,
          targetStatusName: input.targetStatusName,
        });

        const result = await deps.jiraService.changeIssueStatus(
          input.issueKey,
          input.targetStatusName
        );

        if (isErr(result)) {
          const errorMsg = `Failed to change Jira issue status: ${"message" in result.error ? result.error.message : String(result.error)}`;
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
              text: `Error changing Jira issue status: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
