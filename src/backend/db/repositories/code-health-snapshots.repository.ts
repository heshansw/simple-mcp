import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { codeHealthSnapshotsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type CodeHealthSnapshot = typeof codeHealthSnapshotsTable.$inferSelect;
export type NewCodeHealthSnapshot = typeof codeHealthSnapshotsTable.$inferInsert;

export interface CodeHealthSnapshotsRepository {
  create(data: Omit<NewCodeHealthSnapshot, "id" | "createdAt">): Promise<CodeHealthSnapshot>;
  findById(id: string): Promise<CodeHealthSnapshot | undefined>;
  findByDirectory(directoryPath: string, limit?: number): Promise<CodeHealthSnapshot[]>;
  findByWorkspace(workspaceId: string, limit?: number): Promise<CodeHealthSnapshot[]>;
  findLatest(directoryPath: string): Promise<CodeHealthSnapshot | undefined>;
  findAll(limit?: number): Promise<CodeHealthSnapshot[]>;
}

export function createCodeHealthSnapshotsRepository(db: DrizzleDB): CodeHealthSnapshotsRepository {
  return {
    async create(data) {
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.insert(codeHealthSnapshotsTable).values({ ...data, id, createdAt: now });
      const results = await db.select().from(codeHealthSnapshotsTable).where(eq(codeHealthSnapshotsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created snapshot");
      return results[0];
    },
    async findById(id) {
      const results = await db.select().from(codeHealthSnapshotsTable).where(eq(codeHealthSnapshotsTable.id, id));
      return results[0];
    },
    async findByDirectory(directoryPath, limit = 100) {
      return db
        .select()
        .from(codeHealthSnapshotsTable)
        .where(eq(codeHealthSnapshotsTable.directoryPath, directoryPath))
        .orderBy(desc(codeHealthSnapshotsTable.createdAt))
        .limit(limit);
    },
    async findByWorkspace(workspaceId, limit = 100) {
      return db
        .select()
        .from(codeHealthSnapshotsTable)
        .where(eq(codeHealthSnapshotsTable.workspaceId, workspaceId))
        .orderBy(desc(codeHealthSnapshotsTable.createdAt))
        .limit(limit);
    },
    async findLatest(directoryPath) {
      const results = await db
        .select()
        .from(codeHealthSnapshotsTable)
        .where(eq(codeHealthSnapshotsTable.directoryPath, directoryPath))
        .orderBy(desc(codeHealthSnapshotsTable.createdAt))
        .limit(1);
      return results[0];
    },
    async findAll(limit = 100) {
      return db
        .select()
        .from(codeHealthSnapshotsTable)
        .orderBy(desc(codeHealthSnapshotsTable.createdAt))
        .limit(limit);
    },
  };
}
