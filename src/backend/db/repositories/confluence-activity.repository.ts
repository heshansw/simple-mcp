import { desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { confluenceActivityTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type ConfluenceActivity = typeof confluenceActivityTable.$inferSelect;
export type NewConfluenceActivity = typeof confluenceActivityTable.$inferInsert;

export type ConfluenceActivityStats = {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalContentBytes: number;
  totalResultsReturned: number;
  avgDurationMs: number;
  callsByTool: Record<string, number>;
  callsBySpace: Record<string, number>;
  recentErrors: Array<{ toolName: string; errorTag: string; createdAt: string }>;
};

export interface ConfluenceActivityRepository {
  record(data: Omit<NewConfluenceActivity, "id" | "createdAt">): Promise<ConfluenceActivity>;
  findRecent(limit: number): Promise<ConfluenceActivity[]>;
  getStats(): Promise<ConfluenceActivityStats>;
}

export function createConfluenceActivityRepository(
  db: DrizzleDB
): ConfluenceActivityRepository {
  return {
    async record(
      data: Omit<NewConfluenceActivity, "id" | "createdAt">
    ): Promise<ConfluenceActivity> {
      const id = randomUUID();
      const now = new Date().toISOString();

      await db.insert(confluenceActivityTable).values({
        ...data,
        id,
        createdAt: now,
      });

      const results = await db
        .select()
        .from(confluenceActivityTable)
        .where(sql`${confluenceActivityTable.id} = ${id}`);

      const created = results[0];
      if (!created) {
        throw new Error("Failed to retrieve recorded confluence activity");
      }
      return created;
    },

    async findRecent(limit: number): Promise<ConfluenceActivity[]> {
      return await db
        .select()
        .from(confluenceActivityTable)
        .orderBy(desc(confluenceActivityTable.createdAt))
        .limit(limit);
    },

    async getStats(): Promise<ConfluenceActivityStats> {
      const all = await db.select().from(confluenceActivityTable);

      const totalCalls = all.length;
      const successfulCalls = all.filter((a) => a.success === 1).length;
      const failedCalls = totalCalls - successfulCalls;
      const totalContentBytes = all.reduce(
        (sum, a) => sum + a.contentSizeBytes,
        0
      );
      const totalResultsReturned = all.reduce(
        (sum, a) => sum + a.resultCount,
        0
      );
      const avgDurationMs =
        totalCalls > 0
          ? Math.round(
              all.reduce((sum, a) => sum + a.durationMs, 0) / totalCalls
            )
          : 0;

      const callsByTool: Record<string, number> = {};
      const callsBySpace: Record<string, number> = {};

      for (const a of all) {
        callsByTool[a.toolName] = (callsByTool[a.toolName] ?? 0) + 1;
        if (a.spaceKey) {
          callsBySpace[a.spaceKey] =
            (callsBySpace[a.spaceKey] ?? 0) + 1;
        }
      }

      const recentErrors = all
        .filter((a) => a.success === 0 && a.errorTag)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, 10)
        .map((a) => ({
          toolName: a.toolName,
          errorTag: a.errorTag ?? "unknown",
          createdAt: a.createdAt,
        }));

      return {
        totalCalls,
        successfulCalls,
        failedCalls,
        totalContentBytes,
        totalResultsReturned,
        avgDurationMs,
        callsByTool,
        callsBySpace,
        recentErrors,
      };
    },
  };
}
