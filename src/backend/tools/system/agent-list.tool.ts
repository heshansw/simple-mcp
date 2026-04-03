import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { AgentRegistry } from "../../agents/registry.js";

export const AgentListInputSchema = z.object({});

export type AgentListToolDeps = {
  readonly agentRegistry: AgentRegistry;
  readonly connectionManager: {
    readonly hasConnection: (integration: string) => boolean;
    readonly hasTool: (toolName: string) => boolean;
  };
  readonly logger: Logger;
};

export function registerAgentListTool(
  server: McpServer,
  deps: AgentListToolDeps
): void {
  server.tool(
    "agent_list",
    "List all available agents with their current status (ready, missing dependencies, or disabled), required integrations, and required tools.",
    AgentListInputSchema.shape,
    async () => {
      const agents = deps.agentRegistry.getAll();

      const agentsWithStatus = agents.map((agent) => {
        const status = deps.agentRegistry.checkDependencies(
          agent.id,
          deps.connectionManager
        );

        return {
          id: agent.id,
          name: agent.name,
          description: agent.description ?? "",
          version: agent.version,
          status: status?.status ?? "unknown",
          missingDependencies: status?.missingDependencies ?? [],
          requiredIntegrations: agent.requiredIntegrations,
          requiredTools: agent.requiredTools,
        };
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                totalAgents: agentsWithStatus.length,
                readyAgents: agentsWithStatus.filter((a) => a.status === "ready").length,
                agents: agentsWithStatus,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
