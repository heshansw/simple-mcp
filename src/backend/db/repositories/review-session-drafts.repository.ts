import { eq, and, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { reviewSessionDraftsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type ReviewSessionDraft = typeof reviewSessionDraftsTable.$inferSelect;
export type NewReviewSessionDraft = typeof reviewSessionDraftsTable.$inferInsert;

export interface ReviewSessionDraftsRepository {
  upsertDraft(data: {
    sessionId: string;
    agentId: string;
    aiTool: string;
    runId?: string | null;
    model?: string | null;
    verdict: string;
    body: string;
    commentsJson: string;
  }): Promise<ReviewSessionDraft>;
  findBySessionId(sessionId: string): Promise<ReviewSessionDraft[]>;
  findBySessionAndTool(sessionId: string, aiTool: string): Promise<ReviewSessionDraft | undefined>;
}

export function createReviewSessionDraftsRepository(db: DrizzleDB): ReviewSessionDraftsRepository {
  return {
    async upsertDraft(data) {
      const now = new Date().toISOString();

      // Check for existing draft for this (sessionId, agentId, aiTool)
      const existing = await db
        .select()
        .from(reviewSessionDraftsTable)
        .where(
          and(
            eq(reviewSessionDraftsTable.sessionId, data.sessionId),
            eq(reviewSessionDraftsTable.agentId, data.agentId),
            eq(reviewSessionDraftsTable.aiTool, data.aiTool)
          )
        )
        .limit(1);

      if (existing[0]) {
        // Update existing draft
        await db
          .update(reviewSessionDraftsTable)
          .set({
            runId: data.runId ?? null,
            model: data.model ?? null,
            verdict: data.verdict,
            body: data.body,
            commentsJson: data.commentsJson,
            createdAt: now,
          })
          .where(eq(reviewSessionDraftsTable.id, existing[0].id));

        const updated = await db
          .select()
          .from(reviewSessionDraftsTable)
          .where(eq(reviewSessionDraftsTable.id, existing[0].id));
        if (!updated[0]) throw new Error("Failed to retrieve updated draft");
        return updated[0];
      }

      // Insert new draft
      const id = randomUUID();
      const row: NewReviewSessionDraft = {
        id,
        sessionId: data.sessionId,
        agentId: data.agentId,
        aiTool: data.aiTool,
        runId: data.runId ?? null,
        model: data.model ?? null,
        verdict: data.verdict,
        body: data.body,
        commentsJson: data.commentsJson,
        createdAt: now,
      };
      await db.insert(reviewSessionDraftsTable).values(row);
      const results = await db
        .select()
        .from(reviewSessionDraftsTable)
        .where(eq(reviewSessionDraftsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created draft");
      return results[0];
    },

    async findBySessionId(sessionId) {
      return db
        .select()
        .from(reviewSessionDraftsTable)
        .where(eq(reviewSessionDraftsTable.sessionId, sessionId))
        .orderBy(asc(reviewSessionDraftsTable.createdAt));
    },

    async findBySessionAndTool(sessionId, aiTool) {
      const results = await db
        .select()
        .from(reviewSessionDraftsTable)
        .where(
          and(
            eq(reviewSessionDraftsTable.sessionId, sessionId),
            eq(reviewSessionDraftsTable.aiTool, aiTool)
          )
        )
        .limit(1);
      return results[0];
    },
  };
}
