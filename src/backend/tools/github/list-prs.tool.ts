import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";

export const ListPrsInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  state: z
    .enum(["open", "closed", "all"])
    .default("open")
    .describe("Filter PRs by state"),
});

export type ListPrsInput = z.infer<typeof ListPrsInputSchema>;

export type ListPrsToolDeps = {
  githubService: {
    listPullRequests(
      owner: string,
      repo: string,
      state: "open" | "closed" | "all"
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

export function registerListPrsTool(
  server: McpServer,
  deps: ListPrsToolDeps
): void {
  server.tool(
    "github_list_prs",
    "List pull requests from a GitHub repository",
    ListPrsInputSchema.shape,
    async (args) => {
      try {
        const input = ListPrsInputSchema.parse(args);
        deps.logger.info("Listing GitHub pull requests", {
          owner: input.owner,
          repo: input.repo,
          state: input.state,
        });

        const result = await deps.githubService.listPullRequests(
          input.owner,
          input.repo,
          input.state
        );

        if (isErr(result)) {
          const errorMsg = `Failed to list GitHub pull requests: ${result.error.message}`;
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
              text: `Error listing GitHub pull requests: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
