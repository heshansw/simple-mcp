import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { LocalFilesystemService } from "../../services/local-filesystem.service.js";

export const FsReadFileInputSchema = z.object({
  folder_access_id: z.string().min(1),
  relative_path: z.string().min(1),
  encoding: z.enum(["utf-8", "base64"]).default("utf-8"),
});

export function registerFsReadFileTool(
  server: McpServer,
  deps: { fsService: LocalFilesystemService; logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void } }
): void {
  server.tool(
    "fs_read_file",
    "Read the contents of a single file within a registered folder root",
    FsReadFileInputSchema.shape,
    async (args) => {
      try {
        const input = FsReadFileInputSchema.parse(args);
        deps.logger.info("Reading file", { folderId: input.folder_access_id, path: input.relative_path });
        const result = await deps.fsService.readFile(input.folder_access_id, input.relative_path, input.encoding);
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
