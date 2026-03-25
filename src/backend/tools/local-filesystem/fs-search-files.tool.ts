import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { LocalFilesystemService } from "../../services/local-filesystem.service.js";

export const FsSearchFilesInputSchema = z.object({
  folder_access_id: z.string().min(1),
  glob_pattern: z.string().optional(),
  content_query: z.string().optional(),
  max_results: z.number().int().min(1).max(200).default(50),
  include_content_snippet: z.boolean().default(false),
});

export function registerFsSearchFilesTool(
  server: McpServer,
  deps: { fsService: LocalFilesystemService; logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void } }
): void {
  server.tool(
    "fs_search_files",
    "Search for files by glob pattern or content substring within a registered folder root",
    FsSearchFilesInputSchema.shape,
    async (args) => {
      try {
        const input = FsSearchFilesInputSchema.parse(args);
        deps.logger.info("Searching files", { folderId: input.folder_access_id });
        const result = await deps.fsService.searchFiles(input.folder_access_id, {
          ...(input.glob_pattern !== undefined ? { globPattern: input.glob_pattern } : {}),
          ...(input.content_query !== undefined ? { contentQuery: input.content_query } : {}),
          maxResults: input.max_results,
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
