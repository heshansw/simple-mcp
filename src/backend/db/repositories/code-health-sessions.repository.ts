import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { codeHealthSessionsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type CodeHealthSession = typeof codeHealthSessionsTable.$inferSelect;
export type NewCodeHealthSession = typeof codeHealthSessionsTable.$inferInsert;

export interface CodeHealthSessionsRepository {
  create(data: Omit<NewCodeHealthSession, "id" | "createdAt">): Promise<CodeHealthSession>;
  findById(id: string): Promise<CodeHealthSession | undefined>;
  findActive(): Promise<CodeHealthSession[]>;
  findAll(limit?: number): Promise<CodeHealthSession[]>;
  update(id: string, data: Partial<Omit<NewCodeHealthSession, "id" | "createdAt">>): Promise<CodeHealthSession | undefined>;
  findByWorkspace(workspaceId: string, limit?: number): Promise<CodeHealthSession[]>;
}

export function createCodeHealthSessionsRepository(db: DrizzleDB): CodeHealthSessionsRepository {
  return {
    async create(data) {
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.insert(codeHealthSessionsTable).values({ ...data, id, createdAt: now });
      const results = await db
        .select()
        .from(codeHealthSessionsTable)
        .where(eq(codeHealthSessionsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created session");
      return results[0];
    },
    async findById(id) {
      const results = await db
        .select()
        .from(codeHealthSessionsTable)
        .where(eq(codeHealthSessionsTable.id, id));
      return results[0];
    },
    async findActive() {
      return db
        .select()
        .from(codeHealthSessionsTable)
        .where(eq(codeHealthSessionsTable.status, "active"))
        .orderBy(desc(codeHealthSessionsTable.createdAt));
    },
    async findAll(limit = 100) {
      return db
        .select()
        .from(codeHealthSessionsTable)
        .orderBy(desc(codeHealthSessionsTable.createdAt))
        .limit(limit);
    },
    async update(id, data) {
      await db
        .update(codeHealthSessionsTable)
        .set(data)
        .where(eq(codeHealthSessionsTable.id, id));
      const results = await db
        .select()
        .from(codeHealthSessionsTable)
        .where(eq(codeHealthSessionsTable.id, id));
      return results[0];
    },
    async findByWorkspace(workspaceId, limit = 100) {
      return db
        .select()
        .from(codeHealthSessionsTable)
        .where(eq(codeHealthSessionsTable.workspaceId, workspaceId))
        .orderBy(desc(codeHealthSessionsTable.createdAt))
        .limit(limit);
    },
  };
}
