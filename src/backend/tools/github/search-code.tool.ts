import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubService } from "../../services/github.service.js";
import { isErr, domainErrorMessage } from "@shared/result.js";

export const SearchCodeInputSchema = z.object({
  query: z.string().min(1, "Search query cannot be empty"),
});

export type SearchCodeInput = z.infer<typeof SearchCodeInputSchema>;

export type SearchCodeToolDeps = {
  githubService: GitHubService;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerSearchCodeTool(
  server: McpServer,
  deps: SearchCodeToolDeps
): void {
  server.tool(
    "github_search_code",
    "Search for code across GitHub repositories",
    SearchCodeInputSchema.shape,
    async (args) => {
      try {
        const input = SearchCodeInputSchema.parse(args);

        const result = await deps.githubService.searchCode({ query: input.query });

        if (isErr(result)) {
          return {
            content: [{ type: "text" as const, text: `Failed to search code: ${domainErrorMessage(result.error)}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error searching code: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );
}
