import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";

export const SearchIssuesInputSchema = z.object({
  jql: z.string().min(1, "JQL query cannot be empty"),
  maxResults: z.number().int().positive().default(20),
});

export type SearchIssuesInput = z.infer<typeof SearchIssuesInputSchema>;

export type SearchIssuesToolDeps = {
  jiraService: {
    searchIssues(
      jql: string,
      maxResults: number
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

export function registerSearchIssuesTool(
  server: McpServer,
  deps: SearchIssuesToolDeps
): void {
  server.tool(
    "jira_search_issues",
    "Search for Jira issues using JQL (Jira Query Language)",
    SearchIssuesInputSchema.shape,
    async (args) => {
      try {
        const input = SearchIssuesInputSchema.parse(args);
        deps.logger.info("Searching Jira issues", { jql: input.jql });

        const result = await deps.jiraService.searchIssues(
          input.jql,
          input.maxResults
        );

        if (isErr(result)) {
          const errorMsg = `Jira search failed: ${result.error.message}`;
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
              text: `Error searching Jira issues: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
