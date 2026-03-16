import type { Logger } from "pino";

export interface HealthCheckResult {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly status: "healthy" | "unhealthy";
  readonly lastCheckedAt: string;
}

export interface HealthMonitorDependencies {
  readonly connectionManager: {
    readonly getAllConnections: () => Array<{
      readonly id: string;
      readonly name: string;
      readonly integrationType: string;
      readonly status: string;
    }>;
    readonly updateConnectionStatus: (
      connectionId: string,
      status: string
    ) => void;
  };
  readonly logger: Logger;
}

export function createHealthMonitor(
  deps: HealthMonitorDependencies
): () => Promise<void> {
  return async (): Promise<void> => {
    const connections = deps.connectionManager.getAllConnections();

    deps.logger.info(
      { connectionCount: connections.length },
      "Starting health check"
    );

    const healthResults: HealthCheckResult[] = [];
    let healthyCount = 0;
    let unhealthyCount = 0;

    for (const connection of connections) {
      try {
        // TODO: Implement actual connection test logic per integration type
        // - For Jira: GET /rest/api/3/myself
        // - For GitHub: GET /user
        // Currently using placeholder: connection exists = healthy
        const isHealthy = connection.id !== null && connection.id.length > 0;

        const status = isHealthy ? "connected" : "disconnected";
        const healthStatus = isHealthy ? "healthy" : "unhealthy";

        deps.logger.debug(
          {
            connectionId: connection.id,
            connectionName: connection.name,
            integrationType: connection.integrationType,
            status: healthStatus,
          },
          "Health check result"
        );

        // Update connection status in repository
        deps.connectionManager.updateConnectionStatus(connection.id, status);

        healthResults.push({
          connectionId: connection.id,
          connectionName: connection.name,
          status: healthStatus,
          lastCheckedAt: new Date().toISOString(),
        });

        if (isHealthy) {
          healthyCount++;
        } else {
          unhealthyCount++;
        }
      } catch (error) {
        unhealthyCount++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        deps.logger.error(
          {
            connectionId: connection.id,
            connectionName: connection.name,
            error: errorMessage,
          },
          "Error during health check"
        );

        deps.connectionManager.updateConnectionStatus(
          connection.id,
          "disconnected"
        );

        healthResults.push({
          connectionId: connection.id,
          connectionName: connection.name,
          status: "unhealthy",
          lastCheckedAt: new Date().toISOString(),
        });
      }
    }

    deps.logger.info(
      {
        totalChecked: connections.length,
        healthyCount,
        unhealthyCount,
      },
      "Health check completed"
    );
  };
}
