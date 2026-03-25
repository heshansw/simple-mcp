import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FolderAccessRepository } from "../../db/repositories/folder-access.repository.js";

export const FsListFoldersInputSchema = z.object({});

export function registerFsListFoldersTool(
  server: McpServer,
  deps: { folderAccessRepo: FolderAccessRepository; logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void } }
): void {
  server.tool(
    "fs_list_folders",
    "List all registered local filesystem folders with their IDs, names, paths, and status. Use the returned IDs as folder_access_id in other fs_ tools.",
    FsListFoldersInputSchema.shape,
    async () => {
      try {
        const folders = await deps.folderAccessRepo.findAll();
        const result = folders.map((f) => ({
          id: f.id,
          name: f.name,
          absolutePath: f.absolutePath,
          status: f.status,
          recursive: f.recursive === 1,
          allowedExtensions: JSON.parse(f.allowedExtensions) as string[],
          maxFileSizeKb: f.maxFileSizeKb,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
