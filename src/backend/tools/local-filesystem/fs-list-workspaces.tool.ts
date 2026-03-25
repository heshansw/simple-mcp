import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RepoWorkspacesRepository } from "../../db/repositories/repo-workspaces.repository.js";
import type { FolderAccessRepository } from "../../db/repositories/folder-access.repository.js";

export const FsListWorkspacesInputSchema = z.object({});

export function registerFsListWorkspacesTool(
  server: McpServer,
  deps: {
    workspacesRepo: RepoWorkspacesRepository;
    folderAccessRepo: FolderAccessRepository;
    logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
  }
): void {
  server.tool(
    "fs_list_workspaces",
    "List all registered workspaces with their IDs, names, descriptions, and constituent folders. Use the returned workspace ID as workspace_id in fs_workspace_search and fs_workspace_tree tools.",
    FsListWorkspacesInputSchema.shape,
    async () => {
      try {
        const workspaces = await deps.workspacesRepo.findAll();
        const folders = await deps.folderAccessRepo.findAll();

        const result = workspaces.map((ws) => {
          const folderIds = JSON.parse(ws.folderIds) as string[];
          const resolvedFolders = folderIds.map((fid) => {
            const folder = folders.find((f) => f.id === fid);
            return folder
              ? { id: folder.id, name: folder.name, path: folder.absolutePath, status: folder.status }
              : { id: fid, name: "(deleted)", path: "unknown", status: "missing" };
          });
          return {
            id: ws.id,
            name: ws.name,
            description: ws.description,
            folders: resolvedFolders,
          };
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
