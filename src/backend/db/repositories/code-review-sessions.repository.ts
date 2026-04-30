import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { codeReviewSessionsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type CodeReviewSession = typeof codeReviewSessionsTable.$inferSelect;
export type NewCodeReviewSession = typeof codeReviewSessionsTable.$inferInsert;

export interface CodeReviewSessionsRepository {
  create(data: {
    repoPath: string;
    repoName: string;
    repoOwner: string | null;
    diffMode: string;
    branchName: string | null;
    diffContent: string;
    filesChanged: number;
    additions: number;
    deletions: number;
  }): Promise<CodeReviewSession>;
  findById(id: string): Promise<CodeReviewSession | undefined>;
  findByRepoPath(repoPath: string): Promise<CodeReviewSession[]>;
  listAll(limit?: number): Promise<CodeReviewSession[]>;
  updateStatus(id: string, status: string, errorMessage?: string): Promise<void>;
  completeSession(id: string, data: {
    reportMarkdown: string;
    reportUrl: string;
    completedAt: string;
  }): Promise<void>;
}

export function createCodeReviewSessionsRepository(db: DrizzleDB): CodeReviewSessionsRepository {
  return {
    async create(data) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const row: NewCodeReviewSession = {
        id,
        repoPath: data.repoPath,
        repoName: data.repoName,
        repoOwner: data.repoOwner,
        diffMode: data.diffMode,
        branchName: data.branchName,
        status: "reviewing",
        diffContent: data.diffContent,
        filesChanged: data.filesChanged,
        additions: data.additions,
        deletions: data.deletions,
        createdAt: now,
      };
      await db.insert(codeReviewSessionsTable).values(row);
      const results = await db
        .select()
        .from(codeReviewSessionsTable)
        .where(eq(codeReviewSessionsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created code review session");
      return results[0];
    },

    async findById(id) {
      const results = await db
        .select()
        .from(codeReviewSessionsTable)
        .where(eq(codeReviewSessionsTable.id, id))
        .limit(1);
      return results[0];
    },

    async findByRepoPath(repoPath) {
      return db
        .select()
        .from(codeReviewSessionsTable)
        .where(eq(codeReviewSessionsTable.repoPath, repoPath))
        .orderBy(desc(codeReviewSessionsTable.createdAt));
    },

    async listAll(limit = 100) {
      return db
        .select()
        .from(codeReviewSessionsTable)
        .orderBy(desc(codeReviewSessionsTable.createdAt))
        .limit(limit);
    },

    async updateStatus(id, status, errorMessage) {
      const isTerminal = status === "completed" || status === "failed";
      const now = new Date().toISOString();
      await db
        .update(codeReviewSessionsTable)
        .set({
          status,
          ...(errorMessage !== undefined ? { errorMessage } : {}),
          ...(isTerminal ? { completedAt: now } : {}),
        })
        .where(eq(codeReviewSessionsTable.id, id));
    },

    async completeSession(id, data) {
      await db
        .update(codeReviewSessionsTable)
        .set({
          status: "completed",
          reportMarkdown: data.reportMarkdown,
          reportUrl: data.reportUrl,
          completedAt: data.completedAt,
        })
        .where(eq(codeReviewSessionsTable.id, id));
    },
  };
}
