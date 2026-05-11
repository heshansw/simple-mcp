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

  // Register PR review prompt
  const ReviewPrArgsSchema = z.object({
    owner: z.string().describe("Repository owner"),
    repo: z.string().describe("Repository name"),
    prNumber: z.string().describe("Pull request number"),
  });

  server.prompt(
    "review-pr",
    "Guided prompt for performing an AI-powered code review on a pull request",
    ReviewPrArgsSchema.shape,
    async (args) => {
      const parsed = ReviewPrArgsSchema.parse(args);

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `Please review PR #${parsed.prNumber} on ${parsed.owner}/${parsed.repo}.

Use github_get_pr_diff to fetch the PR details and full diff, then perform a thorough code review covering:
1. **Code Quality** — readability, naming, DRY, maintainability
2. **Bugs & Logic Errors** — null handling, edge cases, off-by-one, race conditions
3. **Security** — injection, XSS, credential exposure, unsafe patterns
4. **Performance** — unnecessary allocations, N+1 queries, algorithmic complexity
5. **Testing** — missing tests, untested edge cases
6. **Best Practices** — TypeScript strict compliance, error handling, API design

After your analysis, use github_submit_review to post your review with:
- An overall summary of your findings
- The appropriate verdict (APPROVE, REQUEST_CHANGES, or COMMENT)
- Inline comments on specific lines that need attention

Be constructive — suggest fixes, not just problems. Acknowledge good patterns.`,
            },
          },
        ],
      };
    }
  );

  // Register code-quality-guard prompt
  server.prompt(
    "code-quality-guard",
    "Activates the code quality self-correcting loop. After writing or modifying code, automatically analyze and iterate until quality reaches the target score.",
    z.object({
      targetScore: z.string().optional().default("8").describe("Minimum acceptable score (1-10)"),
      useAiReview: z.string().optional().default("false").describe("Include Claude AI review (slower but more thorough)"),
    }).shape,
    async () => {
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: "Activate code quality guard for this session.",
            },
          },
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: `Code Quality Guard is now active. I will follow these rules for the rest of this session:

## Code Quality Self-Correcting Loop

**After every file I write or modify**, I will automatically:

1. **Analyze** the file using \`code_health_analyze_file\` with the file path
2. **Check** if the score meets the target (minimum 8/10)
3. **If below target**: Review the issues, apply fixes, and re-analyze
4. **Repeat** until the score reaches the target or 3 iterations are completed
5. **Report** the final score and any remaining issues

### Rules
- I will NOT skip the quality check, even for small changes
- I will fix issues in order of severity: critical → warning → info
- I will NOT just suppress warnings — I will fix the root cause
- If I cannot reach the target in 3 iterations, I will report the remaining issues
- For new files, I will aim for score 9+ on the first write

### What I check
- Cyclomatic & cognitive complexity
- Function size and nesting depth
- Code smells (console.log, TODO, magic numbers, god files)
- Parameter counts
- Maintainability index

I will now apply this to every file I create or modify going forward.`,
            },
          },
        ],
      };
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

          const config = await agentConfigsRepo.findByAgentId(agent.id);
          const isEnabled = config?.enabled ? Boolean(config.enabled) : true;

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
          const configPromises = allAgents.map((agent) =>
            agentConfigsRepo.findByAgentId(agent.id)
          );
          const configs = await Promise.all(configPromises);
          const enabledAgents = allAgents.filter((_, idx) => {
            const config = configs[idx];
            return config?.enabled ? Boolean(config.enabled) : true;
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
