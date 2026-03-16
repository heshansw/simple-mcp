import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { credentialsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type Credential = typeof credentialsTable.$inferSelect;
export type NewCredential = typeof credentialsTable.$inferInsert;

export interface CredentialsRepository {
  findByConnectionId(connectionId: string): Credential | undefined;
  create(
    data: Omit<NewCredential, "id" | "createdAt" | "updatedAt">
  ): Credential;
  update(
    id: string,
    data: Partial<Omit<NewCredential, "id" | "createdAt">>
  ): Credential | undefined;
  deleteByConnectionId(connectionId: string): boolean;
}

export function createCredentialsRepository(
  db: DrizzleDB
): CredentialsRepository {
  return {
    findByConnectionId(connectionId: string): Credential | undefined {
      return db
        .select()
        .from(credentialsTable)
        .where(eq(credentialsTable.connectionId, connectionId))
        .get();
    },

    create(
      data: Omit<NewCredential, "id" | "createdAt" | "updatedAt">
    ): Credential {
      const now = new Date().toISOString();
      const id = randomUUID();

      const newCredential: NewCredential = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      db.insert(credentialsTable).values(newCredential).run();

      const created = db
        .select()
        .from(credentialsTable)
        .where(eq(credentialsTable.id, id))
        .get();

      if (!created) {
        throw new Error(`Failed to retrieve created credential with id ${id}`);
      }

      return created;
    },

    update(
      id: string,
      data: Partial<Omit<NewCredential, "id" | "createdAt">>
    ): Credential | undefined {
      const now = new Date().toISOString();

      db.update(credentialsTable)
        .set({
          ...data,
          updatedAt: now,
        })
        .where(eq(credentialsTable.id, id))
        .run();

      return db
        .select()
        .from(credentialsTable)
        .where(eq(credentialsTable.id, id))
        .get();
    },

    deleteByConnectionId(connectionId: string): boolean {
      const result = db
        .delete(credentialsTable)
        .where(eq(credentialsTable.connectionId, connectionId))
        .run();

      return result.changes > 0;
    },
  };
}
