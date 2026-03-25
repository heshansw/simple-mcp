import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { LocalFilesystemService } from "../../services/local-filesystem.service.js";

export const FsGetFileTreeInputSchema = z.object({
  folder_access_id: z.string().min(1),
  max_depth: z.number().int().min(1).max(20).default(5),
  include_hidden: z.boolean().default(false),
});

export function registerFsGetFileTreeTool(
  server: McpServer,
  deps: { fsService: LocalFilesystemService; logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void } }
): void {
  server.tool(
    "fs_get_file_tree",
    "Return a full recursive tree structure of a registered folder root",
    FsGetFileTreeInputSchema.shape,
    async (args) => {
      try {
        const input = FsGetFileTreeInputSchema.parse(args);
        deps.logger.info("Getting file tree", { folderId: input.folder_access_id });
        const result = await deps.fsService.getFileTree(input.folder_access_id, input.max_depth, input.include_hidden);
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
