import type { Logger } from "pino";
import type { AgentDefinition, AgentWithStatus } from "./types";
import type { AgentId } from "@shared/types";

export type AgentRegistryDeps = {
  readonly logger: Logger;
};

export type AgentRegistry = {
  readonly register: (agent: AgentDefinition) => void;
  readonly getAll: () => ReadonlyArray<AgentDefinition>;
  readonly getById: (id: AgentId) => AgentDefinition | undefined;
  readonly getEnabled: (
    agentConfigsRepo: {
      getByAgentId: (agentId: AgentId) => { enabled: boolean } | undefined;
    }
  ) => ReadonlyArray<AgentDefinition>;
  readonly checkDependencies: (
    agentId: AgentId,
    connectionManager: {
      hasConnection: (integration: string) => boolean;
      hasTool: (toolName: string) => boolean;
    }
  ) => AgentWithStatus | undefined;
};

export function createAgentRegistry(deps: AgentRegistryDeps): AgentRegistry {
  const agents = new Map<AgentId, AgentDefinition>();

  return {
    register(agent: AgentDefinition): void {
      agents.set(agent.id, agent);
      deps.logger.debug({ agentId: agent.id }, "Agent registered");
    },

    getAll(): ReadonlyArray<AgentDefinition> {
      return Array.from(agents.values());
    },

    getById(id: AgentId): AgentDefinition | undefined {
      return agents.get(id);
    },

    getEnabled(agentConfigsRepo): ReadonlyArray<AgentDefinition> {
      return Array.from(agents.values()).filter((agent) => {
        const config = agentConfigsRepo.getByAgentId(agent.id);
        return config?.enabled ?? true;
      });
    },

    checkDependencies(
      agentId: AgentId,
      connectionManager
    ): AgentWithStatus | undefined {
      const agent = agents.get(agentId);
      if (!agent) return undefined;

      const missingDependencies: string[] = [];

      // Check required integrations
      for (const integration of agent.requiredIntegrations) {
        if (!connectionManager.hasConnection(integration)) {
          missingDependencies.push(`integration:${integration}`);
        }
      }

      // Check required tools
      for (const tool of agent.requiredTools) {
        if (!connectionManager.hasTool(tool)) {
          missingDependencies.push(`tool:${tool}`);
        }
      }

      const status =
        missingDependencies.length > 0
          ? ("missing_dependencies" as const)
          : ("ready" as const);

      return {
        ...agent,
        status,
        missingDependencies,
      };
    },
  };
}
