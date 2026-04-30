import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AddRepoReviewAgentInputSchema,
} from "@shared/schemas/repo-review-config.schema.js";
import type { RepoReviewConfigsRepository } from "../../db/repositories/repo-review-configs.repository.js";
import type { AgentRegistry } from "../../agents/registry.js";
import { createAgentId } from "@shared/types.js";

export type AddRepoReviewAgentToolDeps = {
  repoReviewConfigsRepo: RepoReviewConfigsRepository;
  agentRegistry: AgentRegistry;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerAddRepoReviewAgentTool(
  server: McpServer,
  deps: AddRepoReviewAgentToolDeps
): void {
  server.registerTool(
    "add_repo_review_agent",
    {
      title: "Add Repo Review Agent",
      description:
        "Add a new agent+AI tool combination for a repository's review system. " +
        "The agentId must be a known agent in the registry. " +
        "If the combination already exists, returns an error — use set_repo_review_config to update.",
      inputSchema: AddRepoReviewAgentInputSchema,
    },
    async (args) => {
      try {
        const input = AddRepoReviewAgentInputSchema.parse(args);

        // Validate agentId against the agent registry
        const agent = deps.agentRegistry.getById(createAgentId(input.agentId));
        if (!agent) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Unknown agentId: ${input.agentId}. Check available agents with list_agents.`,
              },
            ],
            isError: true,
          };
        }

        // Check if config already exists for this combination
        const existing = await deps.repoReviewConfigsRepo.findByOwnerRepo(
          input.owner,
          input.repo
        );
        const duplicate = existing.find(
          (c) => c.agentId === input.agentId && c.aiTool === input.aiTool
        );
        if (duplicate) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Config already exists for this agent+tool combination. Use set_repo_review_config to update it.",
              },
            ],
            isError: true,
          };
        }

        // Insert new config
        const config = await deps.repoReviewConfigsRepo.insertConfig({
          owner: input.owner,
          repo: input.repo,
          agentId: input.agentId,
          aiTool: input.aiTool,
          enabled: input.enabled ? 1 : 0,
          requiresExplicitSelection: input.requiresExplicitSelection ? 1 : 0,
        });

        const result = {
          created: true,
          config: {
            id: config.id,
            owner: config.owner,
            repo: config.repo,
            agentId: config.agentId,
            aiTool: config.aiTool,
            enabled: config.enabled === 1,
            requiresExplicitSelection: config.requiresExplicitSelection === 1,
            createdAt: config.createdAt,
            updatedAt: config.updatedAt,
          },
        };

        deps.logger.info(
          { owner: input.owner, repo: input.repo, agentId: input.agentId, aiTool: input.aiTool },
          "Repo review agent added"
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );
}
