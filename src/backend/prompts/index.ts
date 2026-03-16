import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type pino from "pino";
import type { AgentRegistry } from "../agents/registry.js";
import type { AgentConfigsRepository } from "../db/repositories/agent-configs.repository.js";

const SetupConnectionArgsSchema = z.object({
  integrationType: z.enum(["jira", "github"]).optional().default("jira"),
});

const AgentHelpArgsSchema = z.object({
  agentId: z.string().optional(),
});

export interface RegisterPromptsDeps {
  readonly agentRegistry: AgentRegistry;
  readonly agentConfigsRepo: AgentConfigsRepository;
  readonly logger: pino.Logger;
}

export function registerPrompts(
  server: McpServer,
  deps: RegisterPromptsDeps
): void {
  const { agentRegistry, agentConfigsRepo, logger } = deps;

  // Register setup-connection prompt
  server.prompt(
    "setup-connection",
    "Guided prompt for setting up a new integration connection",
    SetupConnectionArgsSchema.shape,
    async (args) => {
      try {
        const parsed = SetupConnectionArgsSchema.parse(args);
        const integrationType = parsed.integrationType;

        logger.debug(
          { integrationType },
          "Generating setup-connection prompt"
        );

        let instructions = "";

        if (integrationType === "jira") {
          instructions = `You are helping a user set up a Jira integration.

1. Ask for the Jira instance URL (e.g., https://company.atlassian.net)
2. Explain the authentication options:
   - OAuth 2.0 (recommended for cloud instances)
   - API Token (for Jira Server/Data Center)
   - Personal Access Token
3. Guide them to generate credentials:
   - For API Token: https://id.atlassian.com/manage-profile/security/api-tokens
   - For OAuth: Explain the flow
4. Test the connection with a simple API call
5. Ask which projects they want to connect (optional)
6. Confirm successful setup and show available actions

Be friendly and provide links to official documentation.`;
        } else if (integrationType === "github") {
          instructions = `You are helping a user set up a GitHub integration.

1. Ask which type of GitHub instance:
   - GitHub.com (SaaS)
   - GitHub Enterprise (self-hosted)
2. For GitHub.com:
   - Explain Personal Access Token (PAT) vs OAuth App
   - Direct to: https://github.com/settings/tokens
   - Ask for required scopes: repo, read:org, read:user
3. For GitHub Enterprise:
   - Ask for the instance URL
   - Same authentication options
4. Test the connection with a simple API call
5. Ask which repositories they want to connect
6. Confirm successful setup and show available actions

Provide clear instructions for generating tokens and explain security implications.`;
        }

        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: `Help me set up a ${integrationType} integration`,
              },
            },
            {
              role: "assistant" as const,
              content: {
                type: "text" as const,
                text: instructions,
              },
            },
          ],
        };
      } catch (error) {
        logger.error(
          { error },
          "Failed to generate setup-connection prompt"
        );

        return {
          messages: [
            {
              role: "assistant" as const,
              content: {
                type: "text" as const,
                text: "Unable to generate setup instructions. Please contact support.",
              },
            },
          ],
        };
      }
    }
  );

  // Register agent-help prompt
  server.prompt(
    "agent-help",
    "Help guide for understanding and using available agents",
    AgentHelpArgsSchema.shape,
    async (args) => {
      try {
        const parsed = AgentHelpArgsSchema.parse(args);
        const agentId = parsed.agentId;

        logger.debug(
          { agentId },
          "Generating agent-help prompt"
        );

        let helpContent = "";

        if (agentId) {
          // Help for specific agent
          const agent = agentRegistry.getById(agentId as any);
          if (!agent) {
            return {
              messages: [
                {
                  role: "assistant" as const,
                  content: {
                    type: "text" as const,
                    text: `Agent '${agentId}' not found.`,
                  },
                },
              ],
            };
          }

          const config = agentConfigsRepo.findByAgentId(agent.id);
          const isEnabled = config?.enabled ?? true;

          helpContent = `Agent: ${agent.name}
Version: ${agent.version}
Status: ${isEnabled ? "Enabled" : "Disabled"}

Description:
${agent.description || "No description available"}

System Prompt:
${agent.systemPrompt}

Requirements:
- Integrations: ${agent.requiredIntegrations.join(", ") || "None"}
- Tools: ${agent.requiredTools.join(", ") || "None"}

${!isEnabled ? "\nNote: This agent is currently disabled. Enable it in settings to use it." : ""}`;
        } else {
          // General help for all agents
          const allAgents = agentRegistry.getAll();
          const enabledAgents = allAgents.filter((agent) => {
            const config = agentConfigsRepo.findByAgentId(agent.id);
            return config?.enabled ?? true;
          });

          helpContent = `Available Agents Overview
Total: ${allAgents.length}
Enabled: ${enabledAgents.length}

${allAgents.map((agent) => `- ${agent.name} (${agent.id}): ${agent.description || "No description"}`).join("\n")}

To get help for a specific agent, ask with its ID or name.
Each agent has specific requirements (integrations and tools) that must be configured.`;
        }

        return {
          messages: [
            {
              role: "user" as const,
              content: {
                type: "text" as const,
                text: agentId
                  ? `Help me understand the ${agentId} agent`
                  : "What agents are available?",
              },
            },
            {
              role: "assistant" as const,
              content: {
                type: "text" as const,
                text: helpContent,
              },
            },
          ],
        };
      } catch (error) {
        logger.error(
          { error },
          "Failed to generate agent-help prompt"
        );

        return {
          messages: [
            {
              role: "assistant" as const,
              content: {
                type: "text" as const,
                text: "Unable to generate agent help. Please contact support.",
              },
            },
          ],
        };
      }
    }
  );
}
