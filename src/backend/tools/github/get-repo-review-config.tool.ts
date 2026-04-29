import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GetRepoReviewConfigInputSchema,
} from "@shared/schemas/repo-review-config.schema.js";
import type { RepoReviewConfigsRepository } from "../../db/repositories/repo-review-configs.repository.js";

export type GetRepoReviewConfigToolDeps = {
  repoReviewConfigsRepo: RepoReviewConfigsRepository;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerGetRepoReviewConfigTool(
  server: McpServer,
  deps: GetRepoReviewConfigToolDeps
): void {
  server.registerTool(
    "get_repo_review_config",
    {
      title: "Get Repo Review Config",
      description:
        "Returns the current AI tool configuration for a repository's multi-agent review system. " +
        "Shows which AI tools (Claude, Gemini, Codex) are enabled for reviews.",
      inputSchema: GetRepoReviewConfigInputSchema,
    },
    async (args) => {
      try {
        const input = GetRepoReviewConfigInputSchema.parse(args);
        const configs = await deps.repoReviewConfigsRepo.findByOwnerRepo(
          input.owner,
          input.repo
        );

        const result = {
          owner: input.owner,
          repo: input.repo,
          configs: configs.map((c) => ({
            id: c.id,
            aiTool: c.aiTool,
            agentId: c.agentId,
            enabled: c.enabled === 1,
            requiresExplicitSelection: c.requiresExplicitSelection === 1,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
          })),
        };

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
