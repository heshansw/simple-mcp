import { desc, eq, and, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { reviewSessionsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type ReviewSession = typeof reviewSessionsTable.$inferSelect;
export type NewReviewSession = typeof reviewSessionsTable.$inferInsert;

export interface ReviewSessionsRepository {
  create(data: { owner: string; repo: string; prNumber: number }): Promise<ReviewSession>;
  findById(id: string): Promise<ReviewSession | undefined>;
  findActiveByPr(owner: string, repo: string, prNumber: number): Promise<ReviewSession | undefined>;
  updateStatus(id: string, status: string, errorMessage?: string): Promise<void>;
  findAll(limit?: number): Promise<ReviewSession[]>;
}

export function createReviewSessionsRepository(db: DrizzleDB): ReviewSessionsRepository {
  return {
    async create(data) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const row: NewReviewSession = {
        id,
        owner: data.owner,
        repo: data.repo,
        prNumber: data.prNumber,
        status: "reviewing",
        createdAt: now,
      };
      await db.insert(reviewSessionsTable).values(row);
      const results = await db
        .select()
        .from(reviewSessionsTable)
        .where(eq(reviewSessionsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created review session");
      return results[0];
    },

    async findById(id) {
      const results = await db
        .select()
        .from(reviewSessionsTable)
        .where(eq(reviewSessionsTable.id, id))
        .limit(1);
      return results[0];
    },

    async findActiveByPr(owner, repo, prNumber) {
      const results = await db
        .select()
        .from(reviewSessionsTable)
        .where(
          and(
            eq(reviewSessionsTable.owner, owner),
            eq(reviewSessionsTable.repo, repo),
            eq(reviewSessionsTable.prNumber, prNumber),
            or(
              eq(reviewSessionsTable.status, "reviewing"),
              eq(reviewSessionsTable.status, "synthesising")
            )
          )
        )
        .orderBy(desc(reviewSessionsTable.createdAt))
        .limit(1);
      return results[0];
    },

    async updateStatus(id, status, errorMessage) {
      const isTerminal = status === "completed" || status === "failed";
      const now = new Date().toISOString();
      await db
        .update(reviewSessionsTable)
        .set({
          status,
          ...(errorMessage !== undefined ? { errorMessage } : {}),
          ...(isTerminal ? { completedAt: now } : {}),
        })
        .where(eq(reviewSessionsTable.id, id));
    },

    async findAll(limit = 100) {
      return db
        .select()
        .from(reviewSessionsTable)
        .orderBy(desc(reviewSessionsTable.createdAt))
        .limit(limit);
    },
  };
}
