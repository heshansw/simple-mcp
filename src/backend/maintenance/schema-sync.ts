import type { Logger } from "pino";
import type { SyncMetadataRepository } from "../db/repositories/sync-metadata.repository.js";

export interface SyncMetadataType {
  readonly type: string;
  readonly data: string;
  readonly syncedAt: string;
}

export interface SchemaSyncDependencies {
  readonly connectionManager: {
    readonly getAllConnections: () => Array<{
      readonly id: string;
      readonly name: string;
      readonly integrationType: string;
      readonly status: string;
    }>;
  };
  readonly syncMetadataRepo: SyncMetadataRepository;
  readonly jiraService: {
    readonly fetchProjectMetadata: (
      connectionId: string
    ) => Promise<Record<string, unknown>>;
  };
  readonly githubService: {
    readonly fetchRepositoryMetadata: (
      connectionId: string
    ) => Promise<Record<string, unknown>>;
  };
  readonly logger: Logger;
}

export function createSchemaSync(
  deps: SchemaSyncDependencies
): () => Promise<void> {
  return async (): Promise<void> => {
    const connections = deps.connectionManager.getAllConnections();

    deps.logger.info(
      { connectionCount: connections.length },
      "Starting schema sync"
    );

    let syncedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const connection of connections) {
      try {
        // Skip disconnected connections
        if (connection.status !== "connected") {
          deps.logger.debug(
            { connectionId: connection.id, status: connection.status },
            "Skipping sync for inactive connection"
          );
          skippedCount++;
          continue;
        }

        const now = new Date().toISOString();

        if (connection.integrationType === "jira") {
          // TODO: Implement actual Jira project metadata fetch
          // Call Jira REST API /rest/api/3/project to get projects, fields, issue types
          // Handle pagination if applicable
          const metadata = await deps.jiraService.fetchProjectMetadata(
            connection.id
          );

          const metadataJson = JSON.stringify(metadata);
          deps.syncMetadataRepo.upsert(
            connection.id,
            "jira_projects",
            metadataJson,
            now
          );

          deps.logger.debug(
            { connectionId: connection.id, integrationType: "jira" },
            "Jira project metadata synced"
          );

          syncedCount++;
        } else if (connection.integrationType === "github") {
          // TODO: Implement actual GitHub repository metadata fetch
          // Call GitHub REST API /user/repos and related endpoints
          // Handle pagination, pull in repo metadata, collaborators, etc.
          const metadata = await deps.githubService.fetchRepositoryMetadata(
            connection.id
          );

          const metadataJson = JSON.stringify(metadata);
          deps.syncMetadataRepo.upsert(
            connection.id,
            "github_repositories",
            metadataJson,
            now
          );

          deps.logger.debug(
            { connectionId: connection.id, integrationType: "github" },
            "GitHub repository metadata synced"
          );

          syncedCount++;
        } else {
          deps.logger.warn(
            {
              connectionId: connection.id,
              integrationType: connection.integrationType,
            },
            "Unknown integration type, skipping schema sync"
          );
          skippedCount++;
        }
      } catch (error) {
        errorCount++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        deps.logger.error(
          {
            connectionId: connection.id,
            connectionName: connection.name,
            integrationType: connection.integrationType,
            error: errorMessage,
          },
          "Error syncing schema metadata"
        );
      }
    }

    deps.logger.info(
      {
        syncedCount,
        skippedCount,
        errorCount,
        totalCount: connections.length,
      },
      "Schema sync completed"
    );
  };
}
