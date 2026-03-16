import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const ListConnectionsInputSchema = z.object({});

export type ListConnectionsInput = z.infer<typeof ListConnectionsInputSchema>;

export type ListConnectionsToolDeps = {
  connectionManager: {
    listConnections(): Promise<
      Array<{
        id: string;
        name: string;
        type: string;
        status: string;
      }>
    >;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerListConnectionsTool(
  server: McpServer,
  deps: ListConnectionsToolDeps
): void {
  server.tool(
    "system_list_connections",
    "List all registered connections and their status",
    ListConnectionsInputSchema.shape,
    async () => {
      try {
        deps.logger.info("Listing all connections");

        const connections = await deps.connectionManager.listConnections();

        const result = {
          total: connections.length,
          connections,
          timestamp: new Date().toISOString(),
        };

        const successText = JSON.stringify(result, null, 2);
        return {
          content: [{ type: "text" as const, text: successText }],
        };
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        deps.logger.error("Failed to list connections", { error: errorMsg });
        return {
          content: [
            {
              type: "text" as const,
              text: `Error listing connections: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
