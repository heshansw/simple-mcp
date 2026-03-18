import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { connectionsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type Connection = typeof connectionsTable.$inferSelect;
export type NewConnection = typeof connectionsTable.$inferInsert;

export interface ConnectionsRepository {
  findAll(): Promise<Connection[]>;
  findById(id: string): Promise<Connection | undefined>;
  create(data: Omit<NewConnection, "id" | "createdAt" | "updatedAt">): Promise<Connection>;
  update(id: string, data: Partial<Omit<NewConnection, "id" | "createdAt">>): Promise<Connection | undefined>;
  delete(id: string): Promise<boolean>;
}

export function createConnectionsRepository(
  db: DrizzleDB
): ConnectionsRepository {
  return {
    async findAll(): Promise<Connection[]> {
      return await db.select().from(connectionsTable);
    },

    async findById(id: string): Promise<Connection | undefined> {
      const results = await db
        .select()
        .from(connectionsTable)
        .where(eq(connectionsTable.id, id));
      return results[0];
    },

    async create(
      data: Omit<NewConnection, "id" | "createdAt" | "updatedAt">
    ): Promise<Connection> {
      const now = new Date().toISOString();
      const id = randomUUID();

      const newConnection: NewConnection = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(connectionsTable).values(newConnection);

      const results = await db
        .select()
        .from(connectionsTable)
        .where(eq(connectionsTable.id, id));

      const created = results[0];

      if (!created) {
        throw new Error(`Failed to retrieve created connection with id ${id}`);
      }

      return created;
    },

    async update(
      id: string,
      data: Partial<Omit<NewConnection, "id" | "createdAt">>
    ): Promise<Connection | undefined> {
      const now = new Date().toISOString();

      await db
        .update(connectionsTable)
        .set({
          ...data,
          updatedAt: now,
        })
        .where(eq(connectionsTable.id, id));

      const results = await db
        .select()
        .from(connectionsTable)
        .where(eq(connectionsTable.id, id));

      return results[0];
    },

    async delete(id: string): Promise<boolean> {
      await db
        .delete(connectionsTable)
        .where(eq(connectionsTable.id, id));

      return true;
    },
  };
}
