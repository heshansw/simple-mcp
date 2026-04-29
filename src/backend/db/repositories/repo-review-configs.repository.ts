import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { repoReviewConfigsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type RepoReviewConfig = typeof repoReviewConfigsTable.$inferSelect;
export type NewRepoReviewConfig = typeof repoReviewConfigsTable.$inferInsert;

export interface RepoReviewConfigsRepository {
  findByOwnerRepo(owner: string, repo: string): Promise<RepoReviewConfig[]>;
  upsertConfig(data: {
    owner: string;
    repo: string;
    aiTool: string;
    agentId: string;
    enabled: number;
    requiresExplicitSelection?: number | undefined;
  }): Promise<RepoReviewConfig>;
  createDefaults(owner: string, repo: string): Promise<RepoReviewConfig[]>;
}

export function createRepoReviewConfigsRepository(db: DrizzleDB): RepoReviewConfigsRepository {
  return {
    async findByOwnerRepo(owner, repo) {
      return db
        .select()
        .from(repoReviewConfigsTable)
        .where(
          and(
            eq(repoReviewConfigsTable.owner, owner),
            eq(repoReviewConfigsTable.repo, repo)
          )
        );
    },

    async upsertConfig(data) {
      const now = new Date().toISOString();

      // Check if existing row exists for this (owner, repo, aiTool)
      const existing = await db
        .select()
        .from(repoReviewConfigsTable)
        .where(
          and(
            eq(repoReviewConfigsTable.owner, data.owner),
            eq(repoReviewConfigsTable.repo, data.repo),
            eq(repoReviewConfigsTable.aiTool, data.aiTool)
          )
        )
        .limit(1);

      if (existing[0]) {
        // Update existing row
        await db
          .update(repoReviewConfigsTable)
          .set({
            agentId: data.agentId,
            enabled: data.enabled,
            requiresExplicitSelection: data.requiresExplicitSelection ?? existing[0].requiresExplicitSelection,
            updatedAt: now,
          })
          .where(eq(repoReviewConfigsTable.id, existing[0].id));

        const updated = await db
          .select()
          .from(repoReviewConfigsTable)
          .where(eq(repoReviewConfigsTable.id, existing[0].id));
        if (!updated[0]) throw new Error("Failed to retrieve updated config");
        return updated[0];
      }

      // Insert new row
      const id = randomUUID();
      const row: NewRepoReviewConfig = {
        id,
        owner: data.owner,
        repo: data.repo,
        agentId: data.agentId,
        aiTool: data.aiTool,
        enabled: data.enabled,
        requiresExplicitSelection: data.requiresExplicitSelection ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(repoReviewConfigsTable).values(row);
      const results = await db
        .select()
        .from(repoReviewConfigsTable)
        .where(eq(repoReviewConfigsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created config");
      return results[0];
    },

    async createDefaults(owner, repo) {
      const now = new Date().toISOString();
      const defaults: Array<{ aiTool: string; enabled: number; requiresExplicitSelection: number }> = [
        { aiTool: "claude", enabled: 1, requiresExplicitSelection: 0 },
        { aiTool: "gemini", enabled: 1, requiresExplicitSelection: 0 },
        { aiTool: "codex", enabled: 0, requiresExplicitSelection: 1 },
      ];

      const rows: NewRepoReviewConfig[] = defaults.map((d) => ({
        id: randomUUID(),
        owner,
        repo,
        agentId: "backend-pr-reviewer",
        aiTool: d.aiTool,
        enabled: d.enabled,
        requiresExplicitSelection: d.requiresExplicitSelection,
        createdAt: now,
        updatedAt: now,
      }));

      for (const row of rows) {
        await db.insert(repoReviewConfigsTable).values(row);
      }

      return db
        .select()
        .from(repoReviewConfigsTable)
        .where(
          and(
            eq(repoReviewConfigsTable.owner, owner),
            eq(repoReviewConfigsTable.repo, repo)
          )
        );
    },
  };
}
