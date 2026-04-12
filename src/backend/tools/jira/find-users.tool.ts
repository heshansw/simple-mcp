import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";
import {
  JiraFindUsersInputObjectSchema,
  JiraFindUsersInputSchema,
} from "@shared/schemas/jira.schema.js";
import type { JiraFindUsersParams } from "../../services/jira.service.js";
import { createValidationErrorResponse, type ToolLogger } from "./tool-shared.js";

export type FindUsersToolDeps = {
  jiraService: {
    findUsers(params: JiraFindUsersParams): Promise<Result<unknown, DomainError>>;
  };
  logger: ToolLogger;
};

export function registerFindUsersTool(
  server: McpServer,
  deps: FindUsersToolDeps
): void {
  server.tool(
    "jira_find_users",
    "Find Jira users by account ID, query, display name, or email address for assignment and mentions.",
    JiraFindUsersInputObjectSchema.shape,
    async (args: unknown) => {
      const parsed = JiraFindUsersInputSchema.safeParse(args);
      if (!parsed.success) {
        return createValidationErrorResponse(parsed.error);
      }

      try {
        const input = {
          ...(parsed.data.query !== undefined ? { query: parsed.data.query } : {}),
          ...(parsed.data.displayName !== undefined ? { displayName: parsed.data.displayName } : {}),
          ...(parsed.data.emailAddress !== undefined ? { emailAddress: parsed.data.emailAddress } : {}),
          ...(parsed.data.accountId !== undefined ? { accountId: parsed.data.accountId } : {}),
          ...(parsed.data.maxResults !== undefined ? { maxResults: parsed.data.maxResults } : {}),
        };
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
