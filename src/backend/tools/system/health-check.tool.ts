import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const HealthCheckInputSchema = z.object({});

export type HealthCheckInput = z.infer<typeof HealthCheckInputSchema>;

export type HealthCheckToolDeps = {
  connectionManager: {
    getConnection(integrationName: string): unknown;
    getConnectionStatuses(): Promise<Record<string, { status: string }>>;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerHealthCheckTool(
  server: McpServer,
  deps: HealthCheckToolDeps
): void {
  server.tool(
    "system_health_check",
    "Check the health status of the MCP server and its connections",
    HealthCheckInputSchema.shape,
    async () => {
      try {
        deps.logger.info("Performing health check");

        const startTime = Date.now();
        const connectionStatuses = await deps.connectionManager.getConnectionStatuses();
        const uptime = process.uptime();

        const healthInfo = {
          status: "healthy",
          uptime: `${Math.floor(uptime)}s`,
          timestamp: new Date().toISOString(),
          connections: connectionStatuses,
          responseTime: `${Date.now() - startTime}ms`,
        };

        const successText = JSON.stringify(healthInfo, null, 2);
        return {
          content: [{ type: "text" as const, text: successText }],
        };
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        deps.logger.error("Health check failed", { error: errorMsg });
        return {
          content: [
            {
              type: "text" as const,
              text: `Error performing health check: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
