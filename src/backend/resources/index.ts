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

  // Register code health instructions resource
  server.resource(
    "code-health://instructions",
    "Code quality guard instructions — read this to enable automatic quality checks after writing code",
    async () => {
      return {
        contents: [
          {
            uri: "code-health://instructions",
            text: `# Code Quality Guard — MCP Instructions

When the user asks you to activate code quality guard (or uses the code-quality-guard prompt), follow these rules for the rest of the session:

## After Writing or Modifying Any Code File

1. Call \`code_health_analyze_file\` with the file path you just wrote/modified
2. If the score is below 8/10:
   a. Read the issues from the response
   b. Fix the highest-severity issues first (critical → warning → info)
   c. Re-analyze the file
   d. Repeat up to 3 times
3. Report the final score to the user

## Supported File Types
- TypeScript: .ts, .tsx
- JavaScript: .js, .jsx, .mjs
- Java: .java

## Optional: AI-Enhanced Review
Pass \`aiReview: true\` to get Claude CLI-powered qualitative review on top of static analysis. This adds ~15-30 seconds but catches design issues, naming problems, security concerns, and more.

## Available Tools
- \`code_health_analyze_file\` — Analyze a single file
- \`code_health_analyze_directory\` — Analyze all files in a directory
- \`code_health_start_session\` / \`code_health_session_check\` / \`code_health_end_session\` — Track quality across a coding session
- \`code_health_pre_commit_check\` — Quality gate before committing
- \`code_health_hotspots\` — Find worst files by git churn + complexity
- \`code_health_function_ranking\` — Find worst functions across a project

## Scoring
- 8 signals: complexity, maintainability, duplication, function size, type safety, nesting depth, parameter count, code smells
- Score 1-10, Grade A-F
- When AI review is enabled: 70% static + 30% AI blended score`,
          },
        ],
      };
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
