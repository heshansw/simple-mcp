import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StoreAgentReviewDraftInputSchema,
} from "@shared/schemas/review-session.schema.js";
import type { ReviewSessionsRepository } from "../../db/repositories/review-sessions.repository.js";
import type { ReviewSessionDraftsRepository } from "../../db/repositories/review-session-drafts.repository.js";
import type { CodeReviewSessionsRepository } from "../../db/repositories/code-review-sessions.repository.js";
import type { CodeReviewDraftsRepository } from "../../db/repositories/code-review-drafts.repository.js";

export type StoreAgentReviewDraftToolDeps = {
  reviewSessionsRepo: ReviewSessionsRepository;
  reviewSessionDraftsRepo: ReviewSessionDraftsRepository;
  codeReviewSessionsRepo: CodeReviewSessionsRepository;
  codeReviewDraftsRepo: CodeReviewDraftsRepository;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerStoreAgentReviewDraftTool(
  server: McpServer,
  deps: StoreAgentReviewDraftToolDeps
): void {
  server.registerTool(
    "store_agent_review_draft",
    {
      title: "Store Agent Review Draft",
      description:
        "Save a reviewing agent's draft findings without posting to GitHub. " +
        "Called by each AI tool after analyzing a PR diff or local code diff. " +
        "Provide either sessionId (PR review) or codeReviewSessionId (code review), not both. " +
        "Idempotent per (sessionId/codeReviewSessionId, agentId, aiTool) — safe to retry.",
      inputSchema: StoreAgentReviewDraftInputSchema,
    },
    async (args) => {
      try {
        // XOR between sessionId and codeReviewSessionId is enforced by Zod .refine()
        const input = StoreAgentReviewDraftInputSchema.parse(args);

        const hasCodeSession = input.codeReviewSessionId != null && input.codeReviewSessionId.length > 0;

        if (hasCodeSession) {
          // Code review path
          const codeReviewSessionId = input.codeReviewSessionId as string;
          const session = await deps.codeReviewSessionsRepo.findById(codeReviewSessionId);
          if (!session) {
            return {
              content: [{ type: "text" as const, text: "Code review session not found." }],
              isError: true,
            };
          }

          if (session.status === "completed" || session.status === "failed") {
            return {
              content: [{ type: "text" as const, text: "Session is already closed." }],
              isError: true,
            };
          }

          const draft = await deps.codeReviewDraftsRepo.upsertDraft({
            codeReviewSessionId,
            agentId: input.agentId,
            aiTool: input.aiTool,
            runId: input.runId ?? null,
            model: input.model ?? null,
            verdict: input.verdict,
            body: input.body,
            commentsJson: JSON.stringify(input.comments),
          });

          const result = {
            draftId: draft.id,
            codeReviewSessionId: draft.codeReviewSessionId,
            sessionId: null,
            aiTool: draft.aiTool,
            commentCount: input.comments.length,
          };

          deps.logger.info(
            {
              draftId: draft.id,
              codeReviewSessionId,
              agentId: input.agentId,
              aiTool: input.aiTool,
              commentCount: input.comments.length,
            },
            "Code review agent draft stored"
          );

          return {
            content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          };
        }

        // PR review path
        const sessionId = input.sessionId as string;
        const session = await deps.reviewSessionsRepo.findById(sessionId);
        if (!session) {
          return {
            content: [{ type: "text" as const, text: "Session not found" }],
            isError: true,
          };
        }

        if (session.status === "completed" || session.status === "failed") {
          return {
            content: [{ type: "text" as const, text: "Session is already closed." }],
            isError: true,
          };
        }

        const draft = await deps.reviewSessionDraftsRepo.upsertDraft({
          sessionId,
          agentId: input.agentId,
          aiTool: input.aiTool,
          runId: input.runId ?? null,
          model: input.model ?? null,
          verdict: input.verdict,
          body: input.body,
          commentsJson: JSON.stringify(input.comments),
        });

        const result = {
          draftId: draft.id,
          sessionId: draft.sessionId,
          codeReviewSessionId: null,
          aiTool: draft.aiTool,
          commentCount: input.comments.length,
        };

        deps.logger.info(
          {
            draftId: draft.id,
            sessionId,
            agentId: input.agentId,
            aiTool: input.aiTool,
            commentCount: input.comments.length,
          },
          "Agent review draft stored"
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
