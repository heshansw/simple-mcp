import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";

export const SearchCodeInputSchema = z.object({
  query: z.string().min(1, "Search query cannot be empty"),
});

export type SearchCodeInput = z.infer<typeof SearchCodeInputSchema>;

export type SearchCodeToolDeps = {
  githubService: {
    searchCode(query: string): Promise<
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
        deps.logger.info("Searching GitHub code", { query: input.query });

        const result = await deps.githubService.searchCode(input.query);

        if (isErr(result)) {
          const errorMsg = `Failed to search GitHub code: ${result.error.message}`;
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
              text: `Error searching GitHub code: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
