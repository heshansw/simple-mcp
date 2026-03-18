import { desc, eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { reviewsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type Review = typeof reviewsTable.$inferSelect;
export type NewReview = typeof reviewsTable.$inferInsert;

export type ReviewStats = {
  totalReviews: number;
  approvals: number;
  changesRequested: number;
  comments: number;
  totalInlineComments: number;
  totalInputTokensEstimate: number;
  totalOutputTokensEstimate: number;
  reviewsByRepo: Array<{ repo: string; owner: string; count: number }>;
};

export interface ReviewsRepository {
  create(data: Omit<NewReview, "id" | "createdAt">): Promise<Review>;
  findAll(limit?: number): Promise<Review[]>;
  findByRepo(owner: string, repo: string): Promise<Review[]>;
  getStats(): Promise<ReviewStats>;
  isAlreadyReviewed(owner: string, repo: string, prNumber: number): Promise<boolean>;
}

export function createReviewsRepository(db: DrizzleDB): ReviewsRepository {
  return {
    async create(data) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const row: NewReview = { ...data, id, createdAt: now };
      await db.insert(reviewsTable).values(row);
      const results = await db
        .select()
        .from(reviewsTable)
        .where(eq(reviewsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created review");
      return results[0];
    },

    async findAll(limit = 100) {
      return db
        .select()
        .from(reviewsTable)
        .orderBy(desc(reviewsTable.createdAt))
        .limit(limit);
    },

    async findByRepo(owner, repo) {
      return db
        .select()
        .from(reviewsTable)
        .where(
          and(
            eq(reviewsTable.owner, owner),
            eq(reviewsTable.repo, repo)
          )
        )
        .orderBy(desc(reviewsTable.createdAt));
    },

    async getStats() {
      const rows = await db.select().from(reviewsTable);

      const totalReviews = rows.length;
      const approvals = rows.filter((r) => r.verdict === "APPROVE").length;
      const changesRequested = rows.filter((r) => r.verdict === "REQUEST_CHANGES").length;
      const comments = rows.filter((r) => r.verdict === "COMMENT").length;
      const totalInlineComments = rows.reduce((s, r) => s + r.inlineCommentCount, 0);
      const totalInputTokensEstimate = rows.reduce((s, r) => s + (r.inputTokensEstimate ?? 0), 0);
      const totalOutputTokensEstimate = rows.reduce((s, r) => s + (r.outputTokensEstimate ?? 0), 0);

      const repoMap = new Map<string, number>();
      for (const r of rows) {
        const key = `${r.owner}/${r.repo}`;
        repoMap.set(key, (repoMap.get(key) ?? 0) + 1);
      }
      const reviewsByRepo = [...repoMap.entries()]
        .map(([key, count]) => {
          const [owner, repo] = key.split("/") as [string, string];
          return { owner, repo, count };
        })
        .sort((a, b) => b.count - a.count);

      return {
        totalReviews,
        approvals,
        changesRequested,
        comments,
        totalInlineComments,
        totalInputTokensEstimate,
        totalOutputTokensEstimate,
        reviewsByRepo,
      };
    },

    async isAlreadyReviewed(owner, repo, prNumber) {
      const results = await db
        .select({ id: reviewsTable.id })
        .from(reviewsTable)
        .where(
          and(
            eq(reviewsTable.owner, owner),
            eq(reviewsTable.repo, repo),
            eq(reviewsTable.prNumber, prNumber)
          )
        )
        .limit(1);
      return results.length > 0;
    },
  };
}
