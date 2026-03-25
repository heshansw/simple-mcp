import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { LocalFilesystemService } from "../../services/local-filesystem.service.js";

export const FsWorkspaceTreeInputSchema = z.object({
  workspace_id: z.string().min(1),
  max_depth: z.number().int().min(1).max(10).default(3),
  include_hidden: z.boolean().default(false),
});

export function registerFsWorkspaceTreeTool(
  server: McpServer,
  deps: { fsService: LocalFilesystemService; logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void } }
): void {
  server.tool(
    "fs_workspace_tree",
    "Return a merged file tree with each repo as a named top-level node in a workspace",
    FsWorkspaceTreeInputSchema.shape,
    async (args) => {
      try {
        const input = FsWorkspaceTreeInputSchema.parse(args);
        deps.logger.info("Workspace tree", { workspaceId: input.workspace_id });
        const result = await deps.fsService.workspaceTree(input.workspace_id, input.max_depth, input.include_hidden);
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
