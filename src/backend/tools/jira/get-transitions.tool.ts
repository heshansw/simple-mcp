import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";
import {
  JiraGetTransitionsInputSchema,
  type JiraGetTransitionsInput,
} from "@shared/schemas/jira.schema.js";

export type GetTransitionsInput = JiraGetTransitionsInput;

export type GetTransitionsToolDeps = {
  jiraService: {
    getAvailableTransitions(issueKey: string): Promise<Result<unknown, DomainError>>;
  };
  connectionManager: {
    getConnection(integrationName: string): unknown;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerGetTransitionsTool(
  server: McpServer,
  deps: GetTransitionsToolDeps
): void {
  server.tool(
    "jira_get_transitions",
    "List the currently available Jira transitions for an issue, including transition IDs and destination statuses.",
    {
      issueKey: JiraGetTransitionsInputSchema.shape.issueKey,
    },
    async (args: unknown) => {
      try {
        const input = JiraGetTransitionsInputSchema.parse(args);
        deps.logger.info("Fetching Jira transitions", { issueKey: input.issueKey });

        const result = await deps.jiraService.getAvailableTransitions(input.issueKey);

        if (isErr(result)) {
          const errorMsg = `Failed to get Jira transitions: ${"message" in result.error ? result.error.message : String(result.error)}`;
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
              text: `Error fetching Jira transitions: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
