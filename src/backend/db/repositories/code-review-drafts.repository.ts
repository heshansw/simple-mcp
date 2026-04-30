import { eq, and, asc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { codeReviewDraftsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type CodeReviewDraft = typeof codeReviewDraftsTable.$inferSelect;
export type NewCodeReviewDraft = typeof codeReviewDraftsTable.$inferInsert;

export interface CodeReviewDraftsRepository {
  upsertDraft(data: {
    codeReviewSessionId: string;
    agentId: string;
    aiTool: string;
    runId: string | null;
    model: string | null;
    verdict: string;
    body: string;
    commentsJson: string;
  }): Promise<CodeReviewDraft>;
  findBySessionId(codeReviewSessionId: string): Promise<CodeReviewDraft[]>;
}

export function createCodeReviewDraftsRepository(db: DrizzleDB): CodeReviewDraftsRepository {
  return {
    async upsertDraft(data) {
      const now = new Date().toISOString();

      // Check for existing draft for this (codeReviewSessionId, agentId, aiTool)
      const existing = await db
        .select()
        .from(codeReviewDraftsTable)
        .where(
          and(
            eq(codeReviewDraftsTable.codeReviewSessionId, data.codeReviewSessionId),
            eq(codeReviewDraftsTable.agentId, data.agentId),
            eq(codeReviewDraftsTable.aiTool, data.aiTool)
          )
        )
        .limit(1);

      if (existing[0]) {
        // Update existing draft
        await db
          .update(codeReviewDraftsTable)
          .set({
            runId: data.runId,
            model: data.model,
            verdict: data.verdict,
            body: data.body,
            commentsJson: data.commentsJson,
            createdAt: now,
          })
          .where(eq(codeReviewDraftsTable.id, existing[0].id));

        const updated = await db
          .select()
          .from(codeReviewDraftsTable)
          .where(eq(codeReviewDraftsTable.id, existing[0].id));
        if (!updated[0]) throw new Error("Failed to retrieve updated code review draft");
        return updated[0];
      }

      // Insert new draft
      const id = randomUUID();
      const row: NewCodeReviewDraft = {
        id,
        codeReviewSessionId: data.codeReviewSessionId,
        agentId: data.agentId,
        aiTool: data.aiTool,
        runId: data.runId,
        model: data.model,
        verdict: data.verdict,
        body: data.body,
        commentsJson: data.commentsJson,
        createdAt: now,
      };
      await db.insert(codeReviewDraftsTable).values(row);
      const results = await db
        .select()
        .from(codeReviewDraftsTable)
        .where(eq(codeReviewDraftsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created code review draft");
      return results[0];
    },

    async findBySessionId(codeReviewSessionId) {
      return db
        .select()
        .from(codeReviewDraftsTable)
        .where(eq(codeReviewDraftsTable.codeReviewSessionId, codeReviewSessionId))
        .orderBy(asc(codeReviewDraftsTable.createdAt));
    },
  };
}
