import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StartPrReviewSessionInputSchema,
} from "@shared/schemas/review-session.schema.js";
import { isErr } from "@shared/result.js";
import type { RepoReviewConfigsRepository } from "../../db/repositories/repo-review-configs.repository.js";
import type { ReviewSessionsRepository } from "../../db/repositories/review-sessions.repository.js";
import type { ReviewSessionDraftsRepository } from "../../db/repositories/review-session-drafts.repository.js";
import type { GeminiCliService } from "../../services/gemini-cli.service.js";
import type { GeminiCliReviewService } from "../../services/gemini-cli-review.service.js";

export type StartPrReviewSessionToolDeps = {
  repoReviewConfigsRepo: RepoReviewConfigsRepository;
  reviewSessionsRepo: ReviewSessionsRepository;
  reviewSessionDraftsRepo: ReviewSessionDraftsRepository;
  geminiCliService: GeminiCliService | null;
  geminiCliReviewService: GeminiCliReviewService | null;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
  };
};

type ExecutionMode = "client-driven" | "server-cli";

async function resolveGeminiAvailability(
  geminiCliService: GeminiCliService | null
): Promise<boolean> {
  if (!geminiCliService) return false;
  const result = await geminiCliService.isAvailable();
  return !isErr(result);
}

function fireAndForgetGeminiReview(
  deps: StartPrReviewSessionToolDeps,
  sessionId: string,
  owner: string,
  repo: string,
  prNumber: number,
  agentId: string
): void {
  if (!deps.geminiCliReviewService) return;

  const reviewService = deps.geminiCliReviewService;
  const draftsRepo = deps.reviewSessionDraftsRepo;
  const logger = deps.logger;

  // Fire-and-forget: run async without awaiting
  void (async () => {
    try {
      const result = await reviewService.reviewPR({
        sessionId,
        owner,
        repo,
        prNumber,
        agentId,
      });

      if (isErr(result)) {
        logger.error(
          { sessionId, error: result.error },
          "Gemini CLI review failed"
        );
        return;
      }

      const review = result.value;
      await draftsRepo.upsertDraft({
        sessionId,
        agentId,
        aiTool: "gemini",
        model: review.model,
        verdict: review.verdict,
        body: review.body,
        commentsJson: JSON.stringify(review.comments),
      });

      logger.info(
        {
          sessionId,
          verdict: review.verdict,
          commentCount: review.comments.length,
          durationMs: review.durationMs,
        },
        "Gemini CLI review draft stored"
      );
    } catch (error) {
      logger.error(
        { sessionId, error: error instanceof Error ? error.message : String(error) },
        "Gemini CLI review failed unexpectedly"
      );
    }
  })();
}

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
        "enabled agents to dispatch for review. Agents with executionMode 'server-cli' " +
        "are automatically triggered server-side via the Gemini CLI. " +
        "Agents with executionMode 'client-driven' should be started via agent_start_run.",
      inputSchema: StartPrReviewSessionInputSchema,
    },
    async (args) => {
      try {
        const input = StartPrReviewSessionInputSchema.parse(args);
        const geminiAvailable = await resolveGeminiAvailability(deps.geminiCliService);

        const getExecutionMode = (aiTool: string): ExecutionMode =>
          aiTool === "gemini" && geminiAvailable ? "server-cli" : "client-driven";

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

          // Re-trigger Gemini CLI for server-cli slots that don't have a draft yet
          for (const c of enabledConfigs) {
            if (getExecutionMode(c.aiTool) === "server-cli") {
              const existingDraft = await deps.reviewSessionDraftsRepo.findBySessionAndTool(
                existingSession.id,
                c.aiTool
              );
              if (!existingDraft) {
                fireAndForgetGeminiReview(
                  deps,
                  existingSession.id,
                  existingSession.owner,
                  existingSession.repo,
                  existingSession.prNumber,
                  c.agentId
                );
              }
            }
          }

          const result = {
            sessionId: existingSession.id,
            owner: existingSession.owner,
            repo: existingSession.repo,
            prNumber: existingSession.prNumber,
            status: existingSession.status,
            enabledAgents: enabledConfigs.map((c) => ({
              aiTool: c.aiTool,
              agentId: c.agentId,
              executionMode: getExecutionMode(c.aiTool),
              suggestedGoal: `Review PR #${existingSession.prNumber} in ${existingSession.owner}/${existingSession.repo}. When complete, store your findings using store_agent_review_draft with sessionId=${existingSession.id}.`,
            })),
            instructions: `Session ${existingSession.id} already exists. Only call agent_start_run for agents with executionMode "client-driven". Agents with executionMode "server-cli" are handled automatically. When all drafts are stored, run agent_start_run with agentId=review-synthesiser and goal: "Synthesise review session ${existingSession.id} for PR #${existingSession.prNumber} in ${existingSession.owner}/${existingSession.repo}".`,
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
                  error: "No AI tools are enabled for this repository. Use set_repo_review_config to enable at least one.",
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

        // Step 6: Auto-trigger Gemini CLI review for gemini slots
        for (const c of enabledConfigs) {
          if (getExecutionMode(c.aiTool) === "server-cli") {
            fireAndForgetGeminiReview(
              deps,
              session.id,
              input.owner,
              input.repo,
              input.prNumber,
              c.agentId
            );
          }
        }

        // Step 7: Return session + agents
        const result = {
          sessionId: session.id,
          owner: session.owner,
          repo: session.repo,
          prNumber: session.prNumber,
          status: session.status,
          enabledAgents: enabledConfigs.map((c) => ({
            aiTool: c.aiTool,
            agentId: c.agentId,
            executionMode: getExecutionMode(c.aiTool),
            suggestedGoal: `Review PR #${input.prNumber} in ${input.owner}/${input.repo}. When complete, store your findings using store_agent_review_draft with sessionId=${session.id}.`,
          })),
          instructions: `Session ${session.id} created. Only call agent_start_run for agents with executionMode "client-driven". Agents with executionMode "server-cli" (e.g. Gemini) are automatically triggered and their drafts will be stored server-side. When all drafts are stored, run agent_start_run with agentId=review-synthesiser and goal: "Synthesise review session ${session.id} for PR #${input.prNumber} in ${input.owner}/${input.repo}".`,
        };

        deps.logger.info(
          {
            sessionId: session.id,
            owner: input.owner,
            repo: input.repo,
            prNumber: input.prNumber,
            enabledAgentCount: enabledConfigs.length,
            geminiAutoTriggered: geminiAvailable,
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
