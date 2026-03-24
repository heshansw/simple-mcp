import type { Logger } from "pino";
import type { CredentialsRepository } from "../db/repositories/credentials.repository.js";
import type { EncryptionService } from "../services/encryption.service.js";
import type { GoogleCalendarServiceResult, GoogleTokenBundle } from "../services/google-calendar.service.js";

const TOKEN_EXPIRY_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes before actual expiry

export interface TokenRefreshDependencies {
  readonly connectionManager: {
    readonly getAllConnections: () => Array<{
      readonly id: string;
      readonly name: string;
      readonly integrationType: string;
      readonly authMethod: string;
      readonly updatedAt: string;
    }>;
  };
  readonly credentialsRepo: CredentialsRepository;
  readonly encryptionService: EncryptionService;
  readonly logger: Logger;
  readonly googleCalendarService?: GoogleCalendarServiceResult;
}

export function createTokenRefreshTask(
  deps: TokenRefreshDependencies
): () => Promise<void> {
  return async (): Promise<void> => {
    const connections = deps.connectionManager.getAllConnections();

    deps.logger.info(
      { connectionCount: connections.length },
      "Starting token refresh check"
    );

    let refreshedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const connection of connections) {
      try {
        // Skip non-OAuth2 connections
        if (connection.authMethod !== "oauth2") {
          skippedCount++;
          continue;
        }

        const credential = await deps.credentialsRepo.findByConnectionId(
          connection.id
        );
        if (!credential) {
          deps.logger.debug(
            { connectionId: connection.id },
            "No credential found, skipping"
          );
          skippedCount++;
          continue;
        }

        // Handle Google Calendar OAuth2 token refresh
        if (
          connection.integrationType === "google-calendar" &&
          deps.googleCalendarService
        ) {
          try {
            const raw = deps.encryptionService.decrypt(
              credential.encryptedData,
              credential.iv
            );
            const tokens = JSON.parse(raw) as GoogleTokenBundle;

            if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry) {
              deps.logger.warn(
                { connectionId: connection.id },
                "Invalid Google token bundle, skipping"
              );
              skippedCount++;
              continue;
            }

            const expiry = new Date(tokens.expiry).getTime();
            const now = Date.now();

            if (expiry - now < TOKEN_EXPIRY_THRESHOLD_MS) {
              deps.logger.info(
                { connectionId: connection.id, connectionName: connection.name },
                "Google token near expiry, refreshing"
              );

              const result = await deps.googleCalendarService.refreshTokenIfNeeded(
                connection.id,
                tokens
              );

              if (result._tag === "Err") {
                deps.logger.error(
                  { connectionId: connection.id, error: result.error },
                  "Google token refresh failed"
                );
                errorCount++;
              } else {
                refreshedCount++;
              }
            } else {
              deps.logger.debug(
                { connectionId: connection.id },
                "Google token still valid"
              );
            }
          } catch (parseError) {
            deps.logger.error(
              { connectionId: connection.id, error: parseError },
              "Failed to parse Google token bundle"
            );
            errorCount++;
          }
          continue;
        }

        // Generic OAuth2 placeholder for other integrations
        const updatedAtTime = new Date(connection.updatedAt).getTime();
        const now = Date.now();
        const ageMs = now - updatedAtTime;

        if (ageMs > TOKEN_EXPIRY_THRESHOLD_MS) {
          deps.logger.debug(
            {
              connectionId: connection.id,
              connectionName: connection.name,
              ageMs,
              thresholdMs: TOKEN_EXPIRY_THRESHOLD_MS,
            },
            "Token near expiry, would refresh"
          );

          // TODO: Call integration-specific refresh endpoint
          // - For Jira: POST /oauth/token with refresh_token grant
          // - For GitHub: POST https://github.com/login/oauth/access_token

          refreshedCount++;
        } else {
          deps.logger.debug(
            { connectionId: connection.id, ageMs },
            "Token still valid"
          );
        }
      } catch (error) {
        errorCount++;
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        deps.logger.error(
          {
            connectionId: connection.id,
            connectionName: connection.name,
            error: errorMessage,
          },
          "Error refreshing token"
        );
      }
    }

    deps.logger.info(
      { refreshedCount, skippedCount, errorCount, totalCount: connections.length },
      "Token refresh check completed"
    );
  };
}
