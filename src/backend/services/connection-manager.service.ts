import type { Logger } from "pino";
import {
  type Result,
  err,
  ok,
  notFoundError,
  validationError,
  databaseError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";
import type {
  ConnectionsRepository,
  Connection,
} from "../db/repositories/connections.repository.js";
import type {
  CredentialsRepository,
} from "../db/repositories/credentials.repository.js";
import type { EncryptionService } from "./encryption.service.js";

export interface ConnectionManagerDependencies {
  connectionsRepo: ConnectionsRepository;
  credentialsRepo: CredentialsRepository;
  encryptionService: EncryptionService;
  logger: Logger;
}

export interface ConnectionManagerService {
  getAllConnections(): Result<Connection[], DomainError>;
  getConnection(id: string): Result<Connection, DomainError>;
  createConnection(data: {
    name: string;
    integrationType: "jira" | "github";
    baseUrl?: string;
    authMethod: "oauth2" | "api_token" | "personal_access_token";
  }): Result<Connection, DomainError>;
  updateConnection(
    id: string,
    data: {
      name?: string;
      baseUrl?: string;
      status?: "connected" | "disconnected" | "error" | "refreshing";
    }
  ): Result<Connection, DomainError>;
  deleteConnection(id: string): Result<void, DomainError>;
  testConnection(id: string): Result<{ status: string }, DomainError>;
  storeCredentials(connectionId: string, plaintext: string): Result<void, DomainError>;
  getDecryptedCredentials(connectionId: string): Result<string, DomainError>;
  getConnectionStatuses(): Promise<Record<string, { status: string }>>;
  listConnections(): Promise<Array<{
    id: string;
    name: string;
    type: string;
    status: string;
  }>>;
  hasConnection(integration: string): boolean;
  hasTool(toolName: string): boolean;
}

export function createConnectionManagerService(
  deps: ConnectionManagerDependencies
): ConnectionManagerService {
  const { connectionsRepo, credentialsRepo, encryptionService, logger } = deps;

  return {
    getAllConnections(): Result<Connection[], DomainError> {
      try {
        const connections = connectionsRepo.findAll();
        return ok(connections);
      } catch (error) {
        logger.error(
          { error },
          "Failed to retrieve all connections"
        );
        return err(
          databaseError("Failed to retrieve connections", "findAll")
        );
      }
    },

    getConnection(id: string): Result<Connection, DomainError> {
      try {
        const connection = connectionsRepo.findById(id);
        if (!connection) {
          return err(notFoundError("Connection", id));
        }
        return ok(connection);
      } catch (error) {
        logger.error({ error, id }, "Failed to retrieve connection");
        return err(
          databaseError("Failed to retrieve connection", "findById")
        );
      }
    },

    createConnection(data: {
      name: string;
      integrationType: "jira" | "github";
      baseUrl?: string;
      authMethod: "oauth2" | "api_token" | "personal_access_token";
    }): Result<Connection, DomainError> {
      try {
        // Validate input
        if (!data.name || data.name.trim().length === 0) {
          return err(
            validationError("Connection name is required")
          );
        }

        if (!["jira", "github"].includes(data.integrationType)) {
          return err(
            validationError("Invalid integration type", {
              integrationType: "Must be 'jira' or 'github'",
            })
          );
        }

        if (
          !["oauth2", "api_token", "personal_access_token"].includes(
            data.authMethod
          )
        ) {
          return err(
            validationError("Invalid auth method", {
              authMethod:
                "Must be 'oauth2', 'api_token', or 'personal_access_token'",
            })
          );
        }

        const created = connectionsRepo.create({
          name: data.name,
          integrationType: data.integrationType,
          baseUrl: data.baseUrl || "",
          authMethod: data.authMethod,
          status: "disconnected",
        });

        return ok(created);
      } catch (error) {
        logger.error({ error, data }, "Failed to create connection");
        return err(
          databaseError("Failed to create connection", "create")
        );
      }
    },

    updateConnection(
      id: string,
      data: {
        name?: string;
        baseUrl?: string;
        status?: "connected" | "disconnected" | "error" | "refreshing";
      }
    ): Result<Connection, DomainError> {
      try {
        const existing = connectionsRepo.findById(id);
        if (!existing) {
          return err(notFoundError("Connection", id));
        }

        const updateData: Record<string, unknown> = {};

        if (data.name !== undefined) {
          if (data.name.trim().length === 0) {
            return err(validationError("Connection name cannot be empty"));
          }
          updateData.name = data.name;
        }

        if (data.baseUrl !== undefined) {
          updateData.baseUrl = data.baseUrl;
        }

        if (data.status !== undefined) {
          updateData.status = data.status;
        }

        const updated = connectionsRepo.update(id, updateData);
        if (!updated) {
          return err(notFoundError("Connection", id));
        }

        return ok(updated);
      } catch (error) {
        logger.error({ error, id }, "Failed to update connection");
        return err(
          databaseError("Failed to update connection", "update")
        );
      }
    },

    deleteConnection(id: string): Result<void, DomainError> {
      try {
        const existing = connectionsRepo.findById(id);
        if (!existing) {
          return err(notFoundError("Connection", id));
        }

        // Delete associated credentials first
        credentialsRepo.deleteByConnectionId(id);

        // Delete the connection
        const deleted = connectionsRepo.delete(id);
        if (!deleted) {
          return err(notFoundError("Connection", id));
        }

        return ok(undefined);
      } catch (error) {
        logger.error({ error, id }, "Failed to delete connection");
        return err(
          databaseError("Failed to delete connection", "delete")
        );
      }
    },

    testConnection(id: string): Result<{ status: string }, DomainError> {
      try {
        const connection = connectionsRepo.findById(id);
        if (!connection) {
          return err(notFoundError("Connection", id));
        }

        // TODO: Implement real connection testing logic
        // For now, just check if connection exists and return status
        return ok({ status: connection.status });
      } catch (error) {
        logger.error({ error, id }, "Failed to test connection");
        return err(
          databaseError("Failed to test connection", "testConnection")
        );
      }
    },

    storeCredentials(
      connectionId: string,
      plaintext: string
    ): Result<void, DomainError> {
      try {
        const connection = connectionsRepo.findById(connectionId);
        if (!connection) {
          return err(notFoundError("Connection", connectionId));
        }

        if (!plaintext || plaintext.trim().length === 0) {
          return err(validationError("Credentials cannot be empty"));
        }

        // Encrypt the plaintext credentials
        const { encryptedData, iv } = encryptionService.encrypt(plaintext);

        // Check if credentials already exist for this connection
        const existing = credentialsRepo.findByConnectionId(connectionId);

        if (existing) {
          credentialsRepo.update(existing.id, {
            encryptedData,
            iv,
          });
        } else {
          credentialsRepo.create({
            connectionId,
            encryptedData,
            iv,
          });
        }

        return ok(undefined);
      } catch (error) {
        logger.error(
          { error, connectionId },
          "Failed to store credentials"
        );
        return err(
          databaseError("Failed to store credentials", "storeCredentials")
        );
      }
    },

    getDecryptedCredentials(connectionId: string): Result<string, DomainError> {
      try {
        const connection = connectionsRepo.findById(connectionId);
        if (!connection) {
          return err(notFoundError("Connection", connectionId));
        }

        const credential = credentialsRepo.findByConnectionId(connectionId);
        if (!credential) {
          return err(notFoundError("Credential", connectionId));
        }

        // Decrypt the credentials
        const plaintext = encryptionService.decrypt(
          credential.encryptedData,
          credential.iv
        );

        return ok(plaintext);
      } catch (error) {
        logger.error(
          { error, connectionId },
          "Failed to retrieve decrypted credentials"
        );
        return err(
          databaseError(
            "Failed to retrieve credentials",
            "getDecryptedCredentials"
          )
        );
      }
    },

    async getConnectionStatuses(): Promise<Record<string, { status: string }>> {
      try {
        const connections = connectionsRepo.findAll();
        const statuses: Record<string, { status: string }> = {};

        for (const connection of connections) {
          statuses[connection.id] = { status: connection.status };
        }

        return statuses;
      } catch (error) {
        logger.error(
          { error },
          "Failed to get connection statuses"
        );
        return {};
      }
    },

    async listConnections(): Promise<Array<{
      id: string;
      name: string;
      type: string;
      status: string;
    }>> {
      try {
        const connections = connectionsRepo.findAll();
        return connections.map((conn) => ({
          id: conn.id,
          name: conn.name,
          type: conn.integrationType,
          status: conn.status,
        }));
      } catch (error) {
        logger.error(
          { error },
          "Failed to list connections"
        );
        return [];
      }
    },

    hasConnection(integration: string): boolean {
      try {
        const connections = connectionsRepo.findAll();
        return connections.some(
          (conn) => conn.integrationType === integration && conn.status === "connected"
        );
      } catch (error) {
        logger.error(
          { error, integration },
          "Failed to check connection"
        );
        return false;
      }
    },

    hasTool(): boolean {
      // Tools are always available if the server is running
      // This is a placeholder that can be extended to check actual tool availability
      return true;
    },
  };
}
