import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";
import { JiraFindUsersInputSchema } from "@shared/schemas/jira.schema.js";
import type { JiraFindUsersParams } from "../../services/jira.service.js";

export type FindUsersToolDeps = {
  jiraService: {
    findUsers(params: JiraFindUsersParams): Promise<Result<unknown, DomainError>>;
  };
  connectionManager: {
    getConnection(integrationName: string): unknown;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

const FindUsersInputObjectSchema = z.object({
  query: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  emailAddress: z.string().email().optional(),
  accountId: z.string().min(1).optional(),
  maxResults: z.number().int().positive().max(20).default(10),
});

export function registerFindUsersTool(
  server: McpServer,
  deps: FindUsersToolDeps
): void {
  server.tool(
    "jira_find_users",
    "Find Jira users by account ID, query, display name, or email address for assignment and mentions.",
    FindUsersInputObjectSchema.shape,
    async (args: unknown) => {
      try {
        const input = JiraFindUsersInputSchema.parse(args);
        deps.logger.info("Finding Jira users", input);

        const result = await deps.jiraService.findUsers(input);

        if (isErr(result)) {
          const errorMsg = `Failed to find Jira users: ${"message" in result.error ? result.error.message : String(result.error)}`;
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
              text: `Error finding Jira users: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
