import { desc, eq, and, gt, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { codeHealthBackgroundJobsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type CodeHealthBackgroundJob = typeof codeHealthBackgroundJobsTable.$inferSelect;
export type NewCodeHealthBackgroundJob = typeof codeHealthBackgroundJobsTable.$inferInsert;

export interface CodeHealthBackgroundJobsRepository {
  create(data: Omit<NewCodeHealthBackgroundJob, "id" | "createdAt">): Promise<CodeHealthBackgroundJob>;
  findById(id: string): Promise<CodeHealthBackgroundJob | undefined>;
  findRecent(limit?: number): Promise<CodeHealthBackgroundJob[]>;
  findActive(): Promise<CodeHealthBackgroundJob[]>;
  findRecentByFilePath(filePath: string, sinceIso: string): Promise<CodeHealthBackgroundJob | undefined>;
  update(id: string, data: Partial<Omit<NewCodeHealthBackgroundJob, "id" | "createdAt">>): Promise<void>;
  countActive(): Promise<number>;
  findCompletedByDirectory(directoryPath: string, limit?: number): Promise<CodeHealthBackgroundJob[]>;
  countCompletedByDirectory(directoryPath: string): Promise<number>;
}

export function createCodeHealthBackgroundJobsRepository(db: DrizzleDB): CodeHealthBackgroundJobsRepository {
  return {
    async create(data) {
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.insert(codeHealthBackgroundJobsTable).values({ ...data, id, createdAt: now });
      const results = await db.select().from(codeHealthBackgroundJobsTable).where(eq(codeHealthBackgroundJobsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created background job");
      return results[0];
    },

    async findById(id) {
      const results = await db.select().from(codeHealthBackgroundJobsTable).where(eq(codeHealthBackgroundJobsTable.id, id));
      return results[0];
    },

    async findRecent(limit = 50) {
      return db.select().from(codeHealthBackgroundJobsTable)
        .orderBy(desc(codeHealthBackgroundJobsTable.createdAt))
        .limit(limit);
    },

    async findActive() {
      return db.select().from(codeHealthBackgroundJobsTable)
        .where(
          eq(codeHealthBackgroundJobsTable.status, "queued")
        )
        .orderBy(desc(codeHealthBackgroundJobsTable.createdAt));
    },

    async findRecentByFilePath(filePath, sinceIso) {
      const results = await db.select().from(codeHealthBackgroundJobsTable)
        .where(
          and(
            eq(codeHealthBackgroundJobsTable.filePath, filePath),
            eq(codeHealthBackgroundJobsTable.status, "completed"),
            gt(codeHealthBackgroundJobsTable.createdAt, sinceIso)
          )
        )
        .orderBy(desc(codeHealthBackgroundJobsTable.createdAt))
        .limit(1);
      return results[0];
    },

    async update(id, data) {
      await db.update(codeHealthBackgroundJobsTable)
        .set(data)
        .where(eq(codeHealthBackgroundJobsTable.id, id));
    },

    async countActive() {
      const results = await db.select().from(codeHealthBackgroundJobsTable)
        .where(
          eq(codeHealthBackgroundJobsTable.status, "queued")
        );
      return results.length;
    },

    async findCompletedByDirectory(directoryPath, limit = 200) {
      return db.select().from(codeHealthBackgroundJobsTable)
        .where(
          and(
            like(codeHealthBackgroundJobsTable.filePath, `${directoryPath}%`),
            eq(codeHealthBackgroundJobsTable.status, "completed")
          )
        )
        .orderBy(desc(codeHealthBackgroundJobsTable.createdAt))
        .limit(limit);
    },

    async countCompletedByDirectory(directoryPath) {
      const results = await db.select().from(codeHealthBackgroundJobsTable)
        .where(
          and(
            like(codeHealthBackgroundJobsTable.filePath, `${directoryPath}%`),
            eq(codeHealthBackgroundJobsTable.status, "completed")
          )
        );
      return results.length;
    },
  };
}
