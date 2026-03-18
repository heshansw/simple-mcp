import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type pino from "pino";
import type { AgentRegistry } from "../agents/registry.js";
import type {
  ConnectionsRepository,
  Connection,
} from "../db/repositories/connections.repository.js";
import type { AgentConfigsRepository } from "../db/repositories/agent-configs.repository.js";

export interface RegisterResourcesDeps {
  readonly connectionsRepo: ConnectionsRepository;
  readonly agentRegistry: AgentRegistry;
  readonly agentConfigsRepo: AgentConfigsRepository;
  readonly logger: pino.Logger;
}

export function registerResources(
  server: McpServer,
  deps: RegisterResourcesDeps
): void {
  const { connectionsRepo, agentRegistry, agentConfigsRepo, logger } = deps;

  // Register connections list resource
  server.resource(
    "connections://list",
    "List of all configured connections",
    async () => {
      try {
        const connections = await connectionsRepo.findAll();
        logger.debug(
          { connectionCount: connections.length },
          "Fetched connections resource"
        );

        const content = connections.map((conn: Connection) => ({
          uri: `connections://${conn.id}`,
          text: `Connection: ${conn.name} (${conn.integrationType})
ID: ${conn.id}
Status: ${conn.status}
Base URL: ${conn.baseUrl}
Auth Method: ${conn.authMethod}
Created: ${conn.createdAt}
Updated: ${conn.updatedAt}`,
        }));

        return {
          contents: content.length > 0
            ? content
            : [{
                uri: "connections://none",
                text: "No connections configured",
              }],
        };
      } catch (error) {
        logger.error(
          { error },
          "Failed to fetch connections resource"
        );
        return {
          contents: [
            {
              uri: "connections://error",
              text: "Error fetching connections",
            },
          ],
        };
      }
    }
  );

  // Register agents list resource
  server.resource(
    "agents://list",
    "List of all available agents with their status",
    async () => {
      try {
        const agents = agentRegistry.getAll();
        logger.debug(
          { agentCount: agents.length },
          "Fetched agents resource"
        );

        const configPromises = agents.map((agent) =>
          agentConfigsRepo.findByAgentId(agent.id)
        );
        const configs = await Promise.all(configPromises);

        const content = agents.map((agent, idx) => {
          const config = configs[idx];
          const enabled = config?.enabled ? Boolean(config.enabled) : true;

          const requiredIntegrations = agent.requiredIntegrations.join(", ");
          const requiredTools = agent.requiredTools.join(", ");

          return {
            uri: `agents://${agent.id}`,
            text: `Agent: ${agent.name}
ID: ${agent.id}
Version: ${agent.version}
Status: ${enabled ? "enabled" : "disabled"}
Description: ${agent.description || "N/A"}
Required Integrations: ${requiredIntegrations || "None"}
Required Tools: ${requiredTools || "None"}
System Prompt: ${agent.systemPrompt}`,
          };
        });

        return {
          contents: content.length > 0
            ? content
            : [
                {
                  uri: "agents://none",
                  text: "No agents available",
                },
              ],
        };
      } catch (error) {
        logger.error(
          { error },
          "Failed to fetch agents resource"
        );
        return {
          contents: [
            {
              uri: "agents://error",
              text: "Error fetching agents",
            },
          ],
        };
      }
    }
  );
}
