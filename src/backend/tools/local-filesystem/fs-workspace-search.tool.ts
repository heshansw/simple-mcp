import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { LocalFilesystemService } from "../../services/local-filesystem.service.js";

export const FsWorkspaceSearchInputSchema = z.object({
  workspace_id: z.string().min(1),
  glob_pattern: z.string().optional(),
  content_query: z.string().optional(),
  max_results_per_repo: z.number().int().min(1).max(100).default(25),
  include_content_snippet: z.boolean().default(false),
});

export function registerFsWorkspaceSearchTool(
  server: McpServer,
  deps: { fsService: LocalFilesystemService; logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void } }
): void {
  server.tool(
    "fs_workspace_search",
    "Search for files or content across all repos in a workspace in a single call",
    FsWorkspaceSearchInputSchema.shape,
    async (args) => {
      try {
        const input = FsWorkspaceSearchInputSchema.parse(args);
        deps.logger.info("Workspace search", { workspaceId: input.workspace_id });
        const result = await deps.fsService.workspaceSearch(input.workspace_id, {
          ...(input.glob_pattern !== undefined ? { globPattern: input.glob_pattern } : {}),
          ...(input.content_query !== undefined ? { contentQuery: input.content_query } : {}),
          maxResultsPerRepo: input.max_results_per_repo,
          includeContentSnippet: input.include_content_snippet,
        });
        if (isErr(result)) {
          return { content: [{ type: "text" as const, text: `Error: ${domainErrorMessage(result.error)}` }], isError: true };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
