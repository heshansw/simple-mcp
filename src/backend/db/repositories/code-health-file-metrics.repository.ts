import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { codeHealthFileMetricsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type CodeHealthFileMetric = typeof codeHealthFileMetricsTable.$inferSelect;
export type NewCodeHealthFileMetric = typeof codeHealthFileMetricsTable.$inferInsert;

export interface CodeHealthFileMetricsRepository {
  create(data: Omit<NewCodeHealthFileMetric, "id" | "createdAt">): Promise<CodeHealthFileMetric>;
  createMany(data: Omit<NewCodeHealthFileMetric, "id" | "createdAt">[]): Promise<CodeHealthFileMetric[]>;
  findBySnapshot(snapshotId: string): Promise<CodeHealthFileMetric[]>;
  findById(id: string): Promise<CodeHealthFileMetric | undefined>;
}

export function createCodeHealthFileMetricsRepository(db: DrizzleDB): CodeHealthFileMetricsRepository {
  return {
    async create(data) {
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.insert(codeHealthFileMetricsTable).values({ ...data, id, createdAt: now });
      const results = await db
        .select()
        .from(codeHealthFileMetricsTable)
        .where(eq(codeHealthFileMetricsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created file metric");
      return results[0];
    },
    async createMany(data) {
      if (data.length === 0) return [];
      const now = new Date().toISOString();
      const rows = data.map((d) => ({
        ...d,
        id: randomUUID(),
        createdAt: now,
      }));
      await db.insert(codeHealthFileMetricsTable).values(rows);
      const ids = rows.map((r) => r.id);
      const results: CodeHealthFileMetric[] = [];
      for (const id of ids) {
        const found = await db
          .select()
          .from(codeHealthFileMetricsTable)
          .where(eq(codeHealthFileMetricsTable.id, id));
        if (found[0]) results.push(found[0]);
      }
      return results;
    },
    async findBySnapshot(snapshotId) {
      return db
        .select()
        .from(codeHealthFileMetricsTable)
        .where(eq(codeHealthFileMetricsTable.snapshotId, snapshotId))
        .orderBy(desc(codeHealthFileMetricsTable.createdAt));
    },
    async findById(id) {
      const results = await db
        .select()
        .from(codeHealthFileMetricsTable)
        .where(eq(codeHealthFileMetricsTable.id, id));
      return results[0];
    },
  };
}
