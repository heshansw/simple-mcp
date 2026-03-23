import { desc, eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { reviewsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type Review = typeof reviewsTable.$inferSelect;
export type NewReview = typeof reviewsTable.$inferInsert;

export type ReviewStats = {
  totalReviews: number;
  completedReviews: number;
  inProgressReviews: number;
  approvals: number;
  changesRequested: number;
  comments: number;
  totalInlineComments: number;
  totalInputTokensEstimate: number;
  totalOutputTokensEstimate: number;
  totalFilesChanged: number;
  totalAdditions: number;
  totalDeletions: number;
  avgDurationMs: number | null;
  reviewsByRepo: Array<{ repo: string; owner: string; count: number }>;
};

export interface ReviewsRepository {
  /** Create an in-progress review (when diff is fetched) */
  createInProgress(data: {
    owner: string;
    repo: string;
    prNumber: number;
    prTitle: string;
    prAuthor: string;
    filesChanged: number;
    additions: number;
    deletions: number;
    inputTokensEstimate: number | null;
  }): Promise<Review>;

  /** Complete a review (when review is submitted) — updates most-recent in-progress row */
  completeReview(
    owner: string,
    repo: string,
    prNumber: number,
    data: {
      verdict: string;
      inlineCommentCount: number;
      reviewBody: string;
      githubReviewId: number | null;
      githubReviewUrl: string | null;
      outputTokensEstimate: number | null;
    }
  ): Promise<Review | undefined>;

  /** Fallback: insert a completed review directly (no prior in-progress row) */
  createCompleted(data: Omit<NewReview, "id" | "createdAt" | "startedAt" | "status">): Promise<Review>;

  findAll(limit?: number): Promise<Review[]>;
  findByRepo(owner: string, repo: string): Promise<Review[]>;
  findInProgress(): Promise<Review[]>;
  getStats(): Promise<ReviewStats>;
  isAlreadyReviewed(owner: string, repo: string, prNumber: number): Promise<boolean>;
}

export function createReviewsRepository(db: DrizzleDB): ReviewsRepository {
  return {
    async createInProgress(data) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const row: NewReview = {
        id,
        owner: data.owner,
        repo: data.repo,
        prNumber: data.prNumber,
        prTitle: data.prTitle,
        prAuthor: data.prAuthor,
        status: "in_progress",
        verdict: "",
        inlineCommentCount: 0,
        reviewBody: "",
        filesChanged: data.filesChanged,
        additions: data.additions,
        deletions: data.deletions,
        inputTokensEstimate: data.inputTokensEstimate,
        outputTokensEstimate: null,
        githubReviewId: null,
        githubReviewUrl: null,
        startedAt: now,
        completedAt: null,
        createdAt: now,
      };
      await db.insert(reviewsTable).values(row);
      const results = await db.select().from(reviewsTable).where(eq(reviewsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created review");
      return results[0];
    },

    async completeReview(owner, repo, prNumber, data) {
      // Find most recent in-progress review for this PR
      const existing = await db
        .select()
        .from(reviewsTable)
        .where(
          and(
            eq(reviewsTable.owner, owner),
            eq(reviewsTable.repo, repo),
            eq(reviewsTable.prNumber, prNumber),
            eq(reviewsTable.status, "in_progress")
          )
        )
        .orderBy(desc(reviewsTable.createdAt))
        .limit(1);

      const row = existing[0];
      if (!row) return undefined;

      const now = new Date().toISOString();
      await db
        .update(reviewsTable)
        .set({
          status: "completed",
          verdict: data.verdict,
          inlineCommentCount: data.inlineCommentCount,
          reviewBody: data.reviewBody,
          githubReviewId: data.githubReviewId,
          githubReviewUrl: data.githubReviewUrl,
          outputTokensEstimate: data.outputTokensEstimate,
          completedAt: now,
        })
        .where(eq(reviewsTable.id, row.id));

      const results = await db.select().from(reviewsTable).where(eq(reviewsTable.id, row.id));
      return results[0];
    },

    async createCompleted(data) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const row: NewReview = {
        ...data,
        id,
        status: "completed",
        startedAt: now,
        completedAt: now,
        createdAt: now,
      };
      await db.insert(reviewsTable).values(row);
      const results = await db.select().from(reviewsTable).where(eq(reviewsTable.id, id));
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
        .where(and(eq(reviewsTable.owner, owner), eq(reviewsTable.repo, repo)))
        .orderBy(desc(reviewsTable.createdAt));
    },

    async findInProgress() {
      return db
        .select()
        .from(reviewsTable)
        .where(eq(reviewsTable.status, "in_progress"))
        .orderBy(desc(reviewsTable.createdAt));
    },

    async getStats() {
      const rows = await db.select().from(reviewsTable);
      const completed = rows.filter((r) => r.status === "completed");
      const inProgress = rows.filter((r) => r.status === "in_progress");

      // Compute average duration for completed reviews
      const durations = completed
        .filter((r) => r.startedAt && r.completedAt)
        .map((r) => new Date(r.completedAt!).getTime() - new Date(r.startedAt).getTime())
        .filter((d) => d > 0);
      const avgDurationMs =
        durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

      const repoMap = new Map<string, number>();
      for (const r of completed) {
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
        totalReviews: rows.length,
        completedReviews: completed.length,
        inProgressReviews: inProgress.length,
        approvals: completed.filter((r) => r.verdict === "APPROVE").length,
        changesRequested: completed.filter((r) => r.verdict === "REQUEST_CHANGES").length,
        comments: completed.filter((r) => r.verdict === "COMMENT").length,
        totalInlineComments: completed.reduce((s, r) => s + r.inlineCommentCount, 0),
        totalInputTokensEstimate: rows.reduce((s, r) => s + (r.inputTokensEstimate ?? 0), 0),
        totalOutputTokensEstimate: completed.reduce((s, r) => s + (r.outputTokensEstimate ?? 0), 0),
        totalFilesChanged: rows.reduce((s, r) => s + r.filesChanged, 0),
        totalAdditions: rows.reduce((s, r) => s + r.additions, 0),
        totalDeletions: rows.reduce((s, r) => s + r.deletions, 0),
        avgDurationMs,
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
