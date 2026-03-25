import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { folderAccessTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type FolderAccess = typeof folderAccessTable.$inferSelect;
export type NewFolderAccess = typeof folderAccessTable.$inferInsert;

export interface FolderAccessRepository {
  findAll(): Promise<FolderAccess[]>;
  findById(id: string): Promise<FolderAccess | undefined>;
  findByPath(absolutePath: string): Promise<FolderAccess | undefined>;
  create(data: Omit<NewFolderAccess, "id" | "createdAt" | "updatedAt">): Promise<FolderAccess>;
  update(id: string, data: Partial<Omit<NewFolderAccess, "id" | "createdAt">>): Promise<FolderAccess | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createFolderAccessRepository(
  db: DrizzleDB
): FolderAccessRepository {
  return {
    async findAll(): Promise<FolderAccess[]> {
      return await db.select().from(folderAccessTable);
    },

    async findById(id: string): Promise<FolderAccess | undefined> {
      const results = await db
        .select()
        .from(folderAccessTable)
        .where(eq(folderAccessTable.id, id));
      return results[0];
    },

    async findByPath(absolutePath: string): Promise<FolderAccess | undefined> {
      const results = await db
        .select()
        .from(folderAccessTable)
        .where(eq(folderAccessTable.absolutePath, absolutePath));
      return results[0];
    },

    async create(
      data: Omit<NewFolderAccess, "id" | "createdAt" | "updatedAt">
    ): Promise<FolderAccess> {
      const now = new Date().toISOString();
      const id = randomUUID();

      await db.insert(folderAccessTable).values({
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      });

      const results = await db
        .select()
        .from(folderAccessTable)
        .where(eq(folderAccessTable.id, id));

      const created = results[0];
      if (!created) {
        throw new Error(`Failed to retrieve created folder access with id ${id}`);
      }
      return created;
    },

    async update(
      id: string,
      data: Partial<Omit<NewFolderAccess, "id" | "createdAt">>
    ): Promise<FolderAccess | undefined> {
      const now = new Date().toISOString();

      await db
        .update(folderAccessTable)
        .set({ ...data, updatedAt: now })
        .where(eq(folderAccessTable.id, id));

      const results = await db
        .select()
        .from(folderAccessTable)
        .where(eq(folderAccessTable.id, id));
      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      await db.delete(folderAccessTable).where(eq(folderAccessTable.id, id));
      return true;
    },
  };
}
