import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { codeHealthFunctionMetricsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type CodeHealthFunctionMetric = typeof codeHealthFunctionMetricsTable.$inferSelect;
export type NewCodeHealthFunctionMetric = typeof codeHealthFunctionMetricsTable.$inferInsert;

export interface CodeHealthFunctionMetricsRepository {
  create(data: Omit<NewCodeHealthFunctionMetric, "id" | "createdAt">): Promise<CodeHealthFunctionMetric>;
  createMany(data: Omit<NewCodeHealthFunctionMetric, "id" | "createdAt">[]): Promise<CodeHealthFunctionMetric[]>;
  findByFileMetric(fileMetricId: string): Promise<CodeHealthFunctionMetric[]>;
}

export function createCodeHealthFunctionMetricsRepository(db: DrizzleDB): CodeHealthFunctionMetricsRepository {
  return {
    async create(data) {
      const id = randomUUID();
      const now = new Date().toISOString();
      await db.insert(codeHealthFunctionMetricsTable).values({ ...data, id, createdAt: now });
      const results = await db
        .select()
        .from(codeHealthFunctionMetricsTable)
        .where(eq(codeHealthFunctionMetricsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created function metric");
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
      await db.insert(codeHealthFunctionMetricsTable).values(rows);
      const ids = rows.map((r) => r.id);
      const results: CodeHealthFunctionMetric[] = [];
      for (const id of ids) {
        const found = await db
          .select()
          .from(codeHealthFunctionMetricsTable)
          .where(eq(codeHealthFunctionMetricsTable.id, id));
        if (found[0]) results.push(found[0]);
      }
      return results;
    },
    async findByFileMetric(fileMetricId) {
      return db
        .select()
        .from(codeHealthFunctionMetricsTable)
        .where(eq(codeHealthFunctionMetricsTable.fileMetricId, fileMetricId))
        .orderBy(desc(codeHealthFunctionMetricsTable.createdAt));
    },
  };
}
