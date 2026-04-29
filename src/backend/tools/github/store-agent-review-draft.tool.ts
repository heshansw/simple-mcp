import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  StoreAgentReviewDraftInputSchema,
} from "@shared/schemas/review-session.schema.js";
import type { ReviewSessionsRepository } from "../../db/repositories/review-sessions.repository.js";
import type { ReviewSessionDraftsRepository } from "../../db/repositories/review-session-drafts.repository.js";

export type StoreAgentReviewDraftToolDeps = {
  reviewSessionsRepo: ReviewSessionsRepository;
  reviewSessionDraftsRepo: ReviewSessionDraftsRepository;
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
        "Called by each AI tool after analyzing the PR diff. Idempotent per (sessionId, aiTool) — safe to retry.",
      inputSchema: StoreAgentReviewDraftInputSchema,
    },
    async (args) => {
      try {
        const input = StoreAgentReviewDraftInputSchema.parse(args);

        // Validate session exists
        const session = await deps.reviewSessionsRepo.findById(input.sessionId);
        if (!session) {
          return {
            content: [{ type: "text" as const, text: "Session not found" }],
            isError: true,
          };
        }

        // Validate session is not closed
        if (session.status === "completed" || session.status === "failed") {
          return {
            content: [{ type: "text" as const, text: "Session is already closed" }],
            isError: true,
          };
        }

        // Store the draft
        const draft = await deps.reviewSessionDraftsRepo.upsertDraft({
          sessionId: input.sessionId,
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
          aiTool: draft.aiTool,
          commentCount: input.comments.length,
        };

        deps.logger.info(
          {
            draftId: draft.id,
            sessionId: input.sessionId,
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
