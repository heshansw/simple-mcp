import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { LocalFilesystemService } from "../../services/local-filesystem.service.js";

export const FsListDirectoryInputSchema = z.object({
  folder_access_id: z.string().min(1),
  relative_path: z.string().default("."),
  max_depth: z.number().int().min(1).max(10).default(1),
});

export function registerFsListDirectoryTool(
  server: McpServer,
  deps: { fsService: LocalFilesystemService; logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void } }
): void {
  server.tool(
    "fs_list_directory",
    "List files and subdirectories at a given path within a registered folder root",
    FsListDirectoryInputSchema.shape,
    async (args) => {
      try {
        const input = FsListDirectoryInputSchema.parse(args);
        deps.logger.info("Listing directory", { folderId: input.folder_access_id });
        const result = await deps.fsService.listDirectory(input.folder_access_id, input.relative_path, input.max_depth);
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
