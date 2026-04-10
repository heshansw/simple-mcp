import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";
import {
  JiraChangeStatusInputSchema,
  type JiraChangeStatusInput,
} from "@shared/schemas/jira.schema.js";

export type ChangeStatusInput = JiraChangeStatusInput;

export type ChangeStatusToolDeps = {
  jiraService: {
    changeIssueStatus(
      issueKey: string,
      targetStatusName: string
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

export function registerChangeStatusTool(
  server: McpServer,
  deps: ChangeStatusToolDeps
): void {
  server.tool(
    "jira_change_status",
    "Change a Jira issue status by status name. Use this when you know the target status but not the transition ID.",
    {
      issueKey: JiraChangeStatusInputSchema.shape.issueKey,
      targetStatusName: JiraChangeStatusInputSchema.shape.targetStatusName,
    },
    async (args: unknown) => {
      try {
        const input = JiraChangeStatusInputSchema.parse(args);
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
