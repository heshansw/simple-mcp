import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { repoWorkspacesTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type RepoWorkspaceRow = typeof repoWorkspacesTable.$inferSelect;
export type NewRepoWorkspace = typeof repoWorkspacesTable.$inferInsert;

export interface RepoWorkspacesRepository {
  findAll(): Promise<RepoWorkspaceRow[]>;
  findById(id: string): Promise<RepoWorkspaceRow | undefined>;
  findByName(name: string): Promise<RepoWorkspaceRow | undefined>;
  create(data: Omit<NewRepoWorkspace, "id" | "createdAt" | "updatedAt">): Promise<RepoWorkspaceRow>;
  update(id: string, data: Partial<Omit<NewRepoWorkspace, "id" | "createdAt">>): Promise<RepoWorkspaceRow | undefined>;
  delete(id: string): Promise<boolean>;
  removeFolderIdFromAll(folderId: string): Promise<string[]>;
}

export function createRepoWorkspacesRepository(
  db: DrizzleDB
): RepoWorkspacesRepository {
  return {
    async findAll(): Promise<RepoWorkspaceRow[]> {
      return await db.select().from(repoWorkspacesTable);
    },

    async findById(id: string): Promise<RepoWorkspaceRow | undefined> {
      const results = await db
        .select()
        .from(repoWorkspacesTable)
        .where(eq(repoWorkspacesTable.id, id));
      return results[0];
    },

    async findByName(name: string): Promise<RepoWorkspaceRow | undefined> {
      const results = await db
        .select()
        .from(repoWorkspacesTable)
        .where(eq(repoWorkspacesTable.name, name));
      return results[0];
    },

    async create(
      data: Omit<NewRepoWorkspace, "id" | "createdAt" | "updatedAt">
    ): Promise<RepoWorkspaceRow> {
      const now = new Date().toISOString();
      const id = randomUUID();

      await db.insert(repoWorkspacesTable).values({
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      });

      const results = await db
        .select()
        .from(repoWorkspacesTable)
        .where(eq(repoWorkspacesTable.id, id));

      const created = results[0];
      if (!created) {
        throw new Error(`Failed to retrieve created workspace with id ${id}`);
      }
      return created;
    },

    async update(
      id: string,
      data: Partial<Omit<NewRepoWorkspace, "id" | "createdAt">>
    ): Promise<RepoWorkspaceRow | undefined> {
      const now = new Date().toISOString();

      await db
        .update(repoWorkspacesTable)
        .set({ ...data, updatedAt: now })
        .where(eq(repoWorkspacesTable.id, id));

      const results = await db
        .select()
        .from(repoWorkspacesTable)
        .where(eq(repoWorkspacesTable.id, id));
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      await db.delete(repoWorkspacesTable).where(eq(repoWorkspacesTable.id, id));
      return true;
    },

    /**
     * Remove a folder ID from all workspaces' folderIds arrays.
     * Returns IDs of workspaces that were auto-deleted (dropped below 2 entries).
     */
    async removeFolderIdFromAll(folderId: string): Promise<string[]> {
      const allWorkspaces = await db.select().from(repoWorkspacesTable);
      const deletedWorkspaceIds: string[] = [];
      const now = new Date().toISOString();

      for (const ws of allWorkspaces) {
        const folderIds = JSON.parse(ws.folderIds) as string[];
        if (!folderIds.includes(folderId)) continue;

        const updated = folderIds.filter((id) => id !== folderId);

        if (updated.length < 2) {
          // Auto-delete workspace that drops below minimum
          await db.delete(repoWorkspacesTable).where(eq(repoWorkspacesTable.id, ws.id));
          deletedWorkspaceIds.push(ws.id);
        } else {
          await db
            .update(repoWorkspacesTable)
            .set({ folderIds: JSON.stringify(updated), updatedAt: now })
            .where(eq(repoWorkspacesTable.id, ws.id));
        }
      }

      return deletedWorkspaceIds;
    },
  };
}
