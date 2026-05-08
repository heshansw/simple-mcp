import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { codeHealthEventsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type CodeHealthEvent = typeof codeHealthEventsTable.$inferSelect;
export type NewCodeHealthEvent = typeof codeHealthEventsTable.$inferInsert;

export interface CodeHealthEventsRepository {
  create(data: Omit<NewCodeHealthEvent, "id" | "createdAt">): Promise<CodeHealthEvent>;
  findByType(eventType: string, limit?: number): Promise<CodeHealthEvent[]>;
  findByFilePath(filePath: string, limit?: number): Promise<CodeHealthEvent[]>;
  findAll(limit?: number): Promise<CodeHealthEvent[]>;
  findRecent(limit?: number): Promise<CodeHealthEvent[]>;
}

export function createCodeHealthEventsRepository(db: DrizzleDB): CodeHealthEventsRepository {
  return {
    async create(data) {
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.insert(codeHealthEventsTable).values({ ...data, id, createdAt: now });
      const results = await db
        .select()
        .from(codeHealthEventsTable)
        .where(eq(codeHealthEventsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created event");
      return results[0];
    },
    async findByType(eventType, limit = 100) {
      return db
        .select()
        .from(codeHealthEventsTable)
        .where(eq(codeHealthEventsTable.eventType, eventType))
        .orderBy(desc(codeHealthEventsTable.createdAt))
        .limit(limit);
    },
    async findByFilePath(filePath, limit = 100) {
      return db
        .select()
        .from(codeHealthEventsTable)
        .where(eq(codeHealthEventsTable.filePath, filePath))
        .orderBy(desc(codeHealthEventsTable.createdAt))
        .limit(limit);
    },
    async findAll(limit = 100) {
      return db
        .select()
        .from(codeHealthEventsTable)
        .orderBy(desc(codeHealthEventsTable.createdAt))
        .limit(limit);
    },
    async findRecent(limit = 20) {
      return db
        .select()
        .from(codeHealthEventsTable)
        .orderBy(desc(codeHealthEventsTable.createdAt))
        .limit(limit);
    },
  };
}
