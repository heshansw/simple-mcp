import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { credentialsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type Credential = typeof credentialsTable.$inferSelect;
export type NewCredential = typeof credentialsTable.$inferInsert;

export interface CredentialsRepository {
  findByConnectionId(connectionId: string): Promise<Credential | undefined>;
  create(
    data: Omit<NewCredential, "id" | "createdAt" | "updatedAt">
  ): Promise<Credential>;
  update(
    id: string,
    data: Partial<Omit<NewCredential, "id" | "createdAt">>
  ): Promise<Credential | undefined>;
  deleteByConnectionId(connectionId: string): Promise<boolean>;
}

export function createCredentialsRepository(
  db: DrizzleDB
): CredentialsRepository {
  return {
    async findByConnectionId(connectionId: string): Promise<Credential | undefined> {
      const results = await db
        .select()
        .from(credentialsTable)
        .where(eq(credentialsTable.connectionId, connectionId));
      return results[0];
    },

    async create(
      data: Omit<NewCredential, "id" | "createdAt" | "updatedAt">
    ): Promise<Credential> {
      const now = new Date().toISOString();
      const id = randomUUID();

      const newCredential: NewCredential = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(credentialsTable).values(newCredential);

      const results = await db
        .select()
        .from(credentialsTable)
        .where(eq(credentialsTable.id, id));

      const created = results[0];

      if (!created) {
        throw new Error(`Failed to retrieve created credential with id ${id}`);
      }

      return created;
    },

    async update(
      id: string,
      data: Partial<Omit<NewCredential, "id" | "createdAt">>
    ): Promise<Credential | undefined> {
      const now = new Date().toISOString();

      await db
        .update(credentialsTable)
        .set({
          ...data,
          updatedAt: now,
        })
        .where(eq(credentialsTable.id, id));

      const results = await db
        .select()
        .from(credentialsTable)
        .where(eq(credentialsTable.id, id));

      return results[0];
    },

    async deleteByConnectionId(connectionId: string): Promise<boolean> {
      await db
        .delete(credentialsTable)
        .where(eq(credentialsTable.connectionId, connectionId));

      return true;
    },
  };
}
