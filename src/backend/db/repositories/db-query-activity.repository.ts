import { desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { dbQueryActivityTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type DbQueryActivity = typeof dbQueryActivityTable.$inferSelect;
export type NewDbQueryActivity = typeof dbQueryActivityTable.$inferInsert;

export type DbQueryInsightsStats = {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalRowsReturned: number;
  totalResultBytes: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  avgTokensPerCall: number;
  callsByTool: Record<string, number>;
  callsByConnection: Record<string, number>;
  callsByDialect: Record<string, number>;
  tokensByTool: Record<string, { input: number; output: number }>;
  topSchemas: Array<{ schema: string; count: number }>;
  topTables: Array<{ table: string; count: number }>;
  recentErrors: Array<{ toolName: string; errorTag: string; connectionId: string; createdAt: string }>;
};

export interface DbQueryActivityRepository {
  record(data: Omit<NewDbQueryActivity, "id" | "createdAt">): Promise<DbQueryActivity>;
  findRecent(limit: number): Promise<DbQueryActivity[]>;
  findByConnectionId(connectionId: string, limit: number): Promise<DbQueryActivity[]>;
  getStats(): Promise<DbQueryInsightsStats>;
}

export function createDbQueryActivityRepository(
  db: DrizzleDB
): DbQueryActivityRepository {
  return {
    async record(
      data: Omit<NewDbQueryActivity, "id" | "createdAt">
    ): Promise<DbQueryActivity> {
      const id = randomUUID();
      const now = new Date().toISOString();

      await db.insert(dbQueryActivityTable).values({
        ...data,
        id,
        createdAt: now,
      });

      const results = await db
        .select()
        .from(dbQueryActivityTable)
        .where(sql`${dbQueryActivityTable.id} = ${id}`);

      const created = results[0];
      if (!created) {
        throw new Error("Failed to retrieve recorded db query activity");
      }
      return created;
    },

    async findRecent(limit: number): Promise<DbQueryActivity[]> {
      return await db
        .select()
        .from(dbQueryActivityTable)
        .orderBy(desc(dbQueryActivityTable.createdAt))
        .limit(limit);
    },

    async findByConnectionId(
      connectionId: string,
      limit: number
    ): Promise<DbQueryActivity[]> {
      return await db
        .select()
        .from(dbQueryActivityTable)
        .where(sql`${dbQueryActivityTable.connectionId} = ${connectionId}`)
        .orderBy(desc(dbQueryActivityTable.createdAt))
        .limit(limit);
    },

    async getStats(): Promise<DbQueryInsightsStats> {
      const all = await db.select().from(dbQueryActivityTable);

      const totalCalls = all.length;
      const successfulCalls = all.filter((a) => a.success === 1).length;
      const failedCalls = totalCalls - successfulCalls;
      const totalRowsReturned = all.reduce((sum, a) => sum + a.rowCount, 0);
      const totalResultBytes = all.reduce((sum, a) => sum + a.resultSizeBytes, 0);
      const totalInputTokens = all.reduce((sum, a) => sum + a.inputTokensEstimate, 0);
      const totalOutputTokens = all.reduce((sum, a) => sum + a.outputTokensEstimate, 0);
      const totalTokens = totalInputTokens + totalOutputTokens;
      const avgDurationMs =
        totalCalls > 0
          ? Math.round(all.reduce((sum, a) => sum + a.durationMs, 0) / totalCalls)
          : 0;
      const avgTokensPerCall =
        totalCalls > 0 ? Math.round(totalTokens / totalCalls) : 0;

      const callsByTool: Record<string, number> = {};
      const callsByConnection: Record<string, number> = {};
      const callsByDialect: Record<string, number> = {};
      const tokensByTool: Record<string, { input: number; output: number }> = {};
      const schemaCount: Record<string, number> = {};
      const tableCount: Record<string, number> = {};

      for (const a of all) {
        callsByTool[a.toolName] = (callsByTool[a.toolName] ?? 0) + 1;
        callsByConnection[a.connectionId] = (callsByConnection[a.connectionId] ?? 0) + 1;
        callsByDialect[a.dialect] = (callsByDialect[a.dialect] ?? 0) + 1;

        if (!tokensByTool[a.toolName]) {
          tokensByTool[a.toolName] = { input: 0, output: 0 };
        }
        const toolEntry = tokensByTool[a.toolName];
        if (toolEntry) {
          toolEntry.input += a.inputTokensEstimate;
          toolEntry.output += a.outputTokensEstimate;
        }

        if (a.schemaName) {
          schemaCount[a.schemaName] = (schemaCount[a.schemaName] ?? 0) + 1;
        }
        if (a.tableName) {
          tableCount[a.tableName] = (tableCount[a.tableName] ?? 0) + 1;
        }
      }

      const topSchemas = Object.entries(schemaCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([schema, count]) => ({ schema, count }));

      const topTables = Object.entries(tableCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([table, count]) => ({ table, count }));

      const recentErrors = all
        .filter((a) => a.success === 0 && a.errorTag)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10)
        .map((a) => ({
          toolName: a.toolName,
          errorTag: a.errorTag ?? "unknown",
          connectionId: a.connectionId,
          createdAt: a.createdAt,
        }));

      return {
        totalCalls,
        successfulCalls,
        failedCalls,
        totalRowsReturned,
        totalResultBytes,
        totalInputTokens,
        totalOutputTokens,
        totalTokens,
        avgDurationMs,
        avgTokensPerCall,
        callsByTool,
        callsByConnection,
        callsByDialect,
        tokensByTool,
        topSchemas,
        topTables,
        recentErrors,
      };
    },
  };
}
