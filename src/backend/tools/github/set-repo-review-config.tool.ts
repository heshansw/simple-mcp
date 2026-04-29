import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  SetRepoReviewConfigInputSchema,
} from "@shared/schemas/repo-review-config.schema.js";
import type { RepoReviewConfigsRepository } from "../../db/repositories/repo-review-configs.repository.js";

export type SetRepoReviewConfigToolDeps = {
  repoReviewConfigsRepo: RepoReviewConfigsRepository;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerSetRepoReviewConfigTool(
  server: McpServer,
  deps: SetRepoReviewConfigToolDeps
): void {
  server.registerTool(
    "set_repo_review_config",
    {
      title: "Set Repo Review Config",
      description:
        "Enable or disable a specific AI tool for a repository's multi-agent review system. " +
        "If no config exists for the (owner, repo, aiTool) combination, creates it. " +
        "Codex requires explicit opt-in: pass requiresExplicitSelection=false to enable it.",
      inputSchema: SetRepoReviewConfigInputSchema,
    },
    async (args) => {
      try {
        const input = SetRepoReviewConfigInputSchema.parse(args);

        // Business rule: codex cannot be enabled when requiresExplicitSelection is true
        // unless the caller explicitly passes requiresExplicitSelection: false
        if (input.aiTool === "codex" && input.enabled === true) {
          // Check if the caller is explicitly opting in
          if (input.requiresExplicitSelection !== false) {
            // Check existing config
            const existing = await deps.repoReviewConfigsRepo.findByOwnerRepo(
              input.owner,
              input.repo
            );
            const codexConfig = existing.find((c) => c.aiTool === "codex");

            if (!codexConfig || codexConfig.requiresExplicitSelection === 1) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: 'Cannot enable codex: it requires explicit opt-in. Pass "requiresExplicitSelection": false in the same call to confirm.',
                  },
                ],
                isError: true,
              };
            }
          }
        }

        const config = await deps.repoReviewConfigsRepo.upsertConfig({
          owner: input.owner,
          repo: input.repo,
          aiTool: input.aiTool,
          agentId: input.agentId ?? "backend-pr-reviewer",
          enabled: input.enabled ? 1 : 0,
          requiresExplicitSelection:
            input.requiresExplicitSelection !== undefined
              ? input.requiresExplicitSelection ? 1 : 0
              : undefined,
        });

        const result = {
          updated: true,
          config: {
            id: config.id,
            owner: config.owner,
            repo: config.repo,
            aiTool: config.aiTool,
            agentId: config.agentId,
            enabled: config.enabled === 1,
            requiresExplicitSelection: config.requiresExplicitSelection === 1,
            createdAt: config.createdAt,
            updatedAt: config.updatedAt,
          },
        };

        deps.logger.info(
          { owner: input.owner, repo: input.repo, aiTool: input.aiTool, enabled: input.enabled },
          "Repo review config updated"
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
