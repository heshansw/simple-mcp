import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RemoveRepoReviewAgentInputSchema,
} from "@shared/schemas/repo-review-config.schema.js";
import type { RepoReviewConfigsRepository } from "../../db/repositories/repo-review-configs.repository.js";

export type RemoveRepoReviewAgentToolDeps = {
  repoReviewConfigsRepo: RepoReviewConfigsRepository;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerRemoveRepoReviewAgentTool(
  server: McpServer,
  deps: RemoveRepoReviewAgentToolDeps
): void {
  server.registerTool(
    "remove_repo_review_agent",
    {
      title: "Remove Repo Review Agent",
      description:
        "Remove a specific agent+AI tool combination from a repository's review config. " +
        "Hard delete. Cannot remove the last enabled config for a repository.",
      inputSchema: RemoveRepoReviewAgentInputSchema,
    },
    async (args) => {
      try {
        const input = RemoveRepoReviewAgentInputSchema.parse(args);

        // Check if the config exists
        const existing = await deps.repoReviewConfigsRepo.findByOwnerRepo(
          input.owner,
          input.repo
        );
        const target = existing.find(
          (c) => c.agentId === input.agentId && c.aiTool === input.aiTool
        );
        if (!target) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No config found for this agent+tool combination.",
              },
            ],
            isError: true,
          };
        }

        // Check if this is the last enabled config
        if (target.enabled === 1) {
          const enabledCount = await deps.repoReviewConfigsRepo.countEnabledForRepo(
            input.owner,
            input.repo
          );
          if (enabledCount <= 1) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Cannot remove the last enabled agent config for this repository. Disable it instead, or add another agent first.",
                },
              ],
              isError: true,
            };
          }
        }

        // Delete the config
        await deps.repoReviewConfigsRepo.deleteConfig(
          input.owner,
          input.repo,
          input.agentId,
          input.aiTool
        );

        const result = {
          removed: true,
          owner: input.owner,
          repo: input.repo,
          agentId: input.agentId,
          aiTool: input.aiTool,
        };

        deps.logger.info(
          { owner: input.owner, repo: input.repo, agentId: input.agentId, aiTool: input.aiTool },
          "Repo review agent removed"
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
