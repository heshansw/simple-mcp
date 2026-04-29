import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  GetReviewSessionDraftsInputSchema,
} from "@shared/schemas/review-session.schema.js";
import type { ReviewSessionsRepository } from "../../db/repositories/review-sessions.repository.js";
import type { ReviewSessionDraftsRepository } from "../../db/repositories/review-session-drafts.repository.js";

export type GetReviewSessionDraftsToolDeps = {
  reviewSessionsRepo: ReviewSessionsRepository;
  reviewSessionDraftsRepo: ReviewSessionDraftsRepository;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerGetReviewSessionDraftsTool(
  server: McpServer,
  deps: GetReviewSessionDraftsToolDeps
): void {
  server.registerTool(
    "get_review_session_drafts",
    {
      title: "Get Review Session Drafts",
      description:
        "Retrieve all stored review drafts for a session. Returns each agent's draft review " +
        "body, verdict, and inline comments. Used by the synthesiser agent and for inspection.",
      inputSchema: GetReviewSessionDraftsInputSchema,
    },
    async (args) => {
      try {
        const input = GetReviewSessionDraftsInputSchema.parse(args);

        const session = await deps.reviewSessionsRepo.findById(input.sessionId);
        if (!session) {
          return {
            content: [{ type: "text" as const, text: "Session not found" }],
            isError: true,
          };
        }

        const drafts = await deps.reviewSessionDraftsRepo.findBySessionId(input.sessionId);

        const result = {
          sessionId: session.id,
          sessionStatus: session.status,
          prNumber: session.prNumber,
          owner: session.owner,
          repo: session.repo,
          drafts: drafts.map((d) => ({
            id: d.id,
            agentId: d.agentId,
            aiTool: d.aiTool,
            runId: d.runId,
            model: d.model ?? null,
            verdict: d.verdict,
            body: d.body,
            comments: JSON.parse(d.commentsJson),
            createdAt: d.createdAt,
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
