import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StartPrReviewSessionInputSchema,
} from "@shared/schemas/review-session.schema.js";
import type { RepoReviewConfigsRepository } from "../../db/repositories/repo-review-configs.repository.js";
import type { ReviewSessionsRepository } from "../../db/repositories/review-sessions.repository.js";

export type StartPrReviewSessionToolDeps = {
  repoReviewConfigsRepo: RepoReviewConfigsRepository;
  reviewSessionsRepo: ReviewSessionsRepository;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerStartPrReviewSessionTool(
  server: McpServer,
  deps: StartPrReviewSessionToolDeps
): void {
  server.registerTool(
    "start_pr_review_session",
    {
      title: "Start PR Review Session",
      description:
        "Initiate a multi-agent parallel PR review session. Creates a review session, " +
        "auto-creates default AI tool configs if none exist, and returns the list of " +
        "enabled agents to dispatch for review. Each agent should be started via agent_start_run.",
      inputSchema: StartPrReviewSessionInputSchema,
    },
    async (args) => {
      try {
        const input = StartPrReviewSessionInputSchema.parse(args);

        // Check for existing active session for this PR
        const existingSession = await deps.reviewSessionsRepo.findActiveByPr(
          input.owner,
          input.repo,
          input.prNumber
        );
        if (existingSession) {
          // Return existing session rather than creating a duplicate
          const configs = await deps.repoReviewConfigsRepo.findByOwnerRepo(
            input.owner,
            input.repo
          );
          const enabledConfigs = configs.filter((c) => c.enabled === 1);

          const result = {
            sessionId: existingSession.id,
            owner: existingSession.owner,
            repo: existingSession.repo,
            prNumber: existingSession.prNumber,
            status: existingSession.status,
            enabledAgents: enabledConfigs.map((c) => ({
              aiTool: c.aiTool,
              agentId: c.agentId,
              suggestedGoal: `Review PR #${existingSession.prNumber} in ${existingSession.owner}/${existingSession.repo} as ${c.agentId}. When complete, store your findings using store_agent_review_draft with sessionId=${existingSession.id}, agentId=${c.agentId}, aiTool=${c.aiTool}.`,
            })),
            instructions: `Session ${existingSession.id} already exists. Call agent_start_run for each entry in enabledAgents using the suggestedGoal. When all drafts are stored, run agent_start_run with agentId=review-synthesiser and goal: "Synthesise review session ${existingSession.id} for PR #${existingSession.prNumber} in ${existingSession.owner}/${existingSession.repo}".`,
          };

          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        // Step 1: Look up configs
        let configs = await deps.repoReviewConfigsRepo.findByOwnerRepo(
          input.owner,
          input.repo
        );

        // Step 2: Auto-create defaults if no rows found
        if (configs.length === 0) {
          configs = await deps.repoReviewConfigsRepo.createDefaults(
            input.owner,
            input.repo
          );
        }

        // Step 3: Filter to enabled
        const enabledConfigs = configs.filter((c) => c.enabled === 1);

        // Step 4: Check at least one is enabled
        if (enabledConfigs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "No agents are enabled for this repository. Use set_repo_review_config to enable at least one.",
                  owner: input.owner,
                  repo: input.repo,
                }),
              },
            ],
            isError: true,
          };
        }

        // Step 5: Create session
        let session;
        try {
          session = await deps.reviewSessionsRepo.create({
            owner: input.owner,
            repo: input.repo,
            prNumber: input.prNumber,
          });
        } catch (dbErr) {
          deps.logger.error({ error: dbErr }, "Failed to create review session");
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: "Failed to create review session",
                  owner: input.owner,
                  repo: input.repo,
                }),
              },
            ],
            isError: true,
          };
        }

        // Step 6: Return session + agents (one entry per enabled agentId+aiTool pair)
        const result = {
          sessionId: session.id,
          owner: session.owner,
          repo: session.repo,
          prNumber: session.prNumber,
          status: session.status,
          enabledAgents: enabledConfigs.map((c) => ({
            aiTool: c.aiTool,
            agentId: c.agentId,
            suggestedGoal: `Review PR #${input.prNumber} in ${input.owner}/${input.repo} as ${c.agentId}. When complete, store your findings using store_agent_review_draft with sessionId=${session.id}, agentId=${c.agentId}, aiTool=${c.aiTool}.`,
          })),
          instructions: `Session ${session.id} created. Call agent_start_run for each entry in enabledAgents using the suggestedGoal. When all drafts are stored, run agent_start_run with agentId=review-synthesiser and goal: "Synthesise review session ${session.id} for PR #${input.prNumber} in ${input.owner}/${input.repo}".`,
        };

        deps.logger.info(
          {
            sessionId: session.id,
            owner: input.owner,
            repo: input.repo,
            prNumber: input.prNumber,
            enabledAgentCount: enabledConfigs.length,
          },
          "PR review session started"
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
