import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  GetCodeReviewSessionDraftsInputSchema,
  DraftCommentSchema,
} from "@shared/schemas/code-review.schema.js";
import type { CodeReviewSessionsRepository } from "../../db/repositories/code-review-sessions.repository.js";
import type { CodeReviewDraftsRepository } from "../../db/repositories/code-review-drafts.repository.js";

export type GetCodeReviewSessionDraftsToolDeps = {
  codeReviewSessionsRepo: CodeReviewSessionsRepository;
  codeReviewDraftsRepo: CodeReviewDraftsRepository;
  logger: {
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerGetCodeReviewSessionDraftsTool(
  server: McpServer,
  deps: GetCodeReviewSessionDraftsToolDeps
): void {
  server.registerTool(
    "get_code_review_session_drafts",
    {
      title: "Get Code Review Session Drafts",
      description:
        "Retrieve all stored review drafts for a code review session. Returns each agent's " +
        "draft review body, verdict, and inline comments. Used by the synthesiser agent.",
      inputSchema: GetCodeReviewSessionDraftsInputSchema,
    },
    async (args) => {
      try {
        const input = GetCodeReviewSessionDraftsInputSchema.parse(args);

        const session = await deps.codeReviewSessionsRepo.findById(input.codeReviewSessionId);
        if (!session) {
          return {
            content: [{ type: "text" as const, text: "Code review session not found." }],
            isError: true,
          };
        }

        const drafts = await deps.codeReviewDraftsRepo.findBySessionId(input.codeReviewSessionId);

        const result = {
          codeReviewSessionId: session.id,
          sessionStatus: session.status,
          repoName: session.repoName,
          repoPath: session.repoPath,
          diffMode: session.diffMode,
          filesChanged: session.filesChanged,
          additions: session.additions,
          deletions: session.deletions,
          drafts: drafts.map((d) => {
            // Parse commentsJson with Zod, dropping invalid entries
            let comments: unknown[] = [];
            try {
              const parsed = JSON.parse(d.commentsJson);
              if (Array.isArray(parsed)) {
                const commentsSchema = z.array(DraftCommentSchema);
                const parseResult = commentsSchema.safeParse(parsed);
                if (parseResult.success) {
                  comments = parseResult.data;
                } else {
                  // Drop invalid elements, keep valid ones
                  comments = parsed.filter((item: unknown) => {
                    const r = DraftCommentSchema.safeParse(item);
                    if (!r.success) {
                      deps.logger.warn(
                        { draftId: d.id, error: r.error.message },
                        "Dropped invalid comment from code review draft"
                      );
                    }
                    return r.success;
                  }).map((item: unknown) => DraftCommentSchema.parse(item));
                }
              }
            } catch (parseErr) {
              deps.logger.warn(
                { draftId: d.id, error: parseErr },
                "Failed to parse commentsJson for code review draft"
              );
            }

            return {
              id: d.id,
              agentId: d.agentId,
              aiTool: d.aiTool,
              runId: d.runId,
              model: d.model ?? null,
              verdict: d.verdict,
              body: d.body,
              comments,
              createdAt: d.createdAt,
            };
          }),
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
