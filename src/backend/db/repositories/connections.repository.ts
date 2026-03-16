import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { connectionsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type Connection = typeof connectionsTable.$inferSelect;
export type NewConnection = typeof connectionsTable.$inferInsert;

export interface ConnectionsRepository {
  findAll(): Connection[];
  findById(id: string): Connection | undefined;
  create(data: Omit<NewConnection, "id" | "createdAt" | "updatedAt">): Connection;
  update(id: string, data: Partial<Omit<NewConnection, "id" | "createdAt">>): Connection | undefined;
  delete(id: string): boolean;
}

export function createConnectionsRepository(
  db: DrizzleDB
): ConnectionsRepository {
  return {
    findAll(): Connection[] {
      return db.select().from(connectionsTable).all();
    },

    findById(id: string): Connection | undefined {
      return db
        .select()
        .from(connectionsTable)
        .where(eq(connectionsTable.id, id))
        .get();
    },

    create(
      data: Omit<NewConnection, "id" | "createdAt" | "updatedAt">
    ): Connection {
      const now = new Date().toISOString();
      const id = randomUUID();

      const newConnection: NewConnection = {
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      };

      db.insert(connectionsTable).values(newConnection).run();

      const created = db
        .select()
        .from(connectionsTable)
        .where(eq(connectionsTable.id, id))
        .get();

      if (!created) {
        throw new Error(`Failed to retrieve created connection with id ${id}`);
      }

      return created;
    },

    update(
      id: string,
      data: Partial<Omit<NewConnection, "id" | "createdAt">>
    ): Connection | undefined {
      const now = new Date().toISOString();

      db.update(connectionsTable)
        .set({
          ...data,
          updatedAt: now,
        })
        .where(eq(connectionsTable.id, id))
        .run();

      return db
        .select()
        .from(connectionsTable)
        .where(eq(connectionsTable.id, id))
        .get();
    },

    delete(id: string): boolean {
      const result = db
        .delete(connectionsTable)
        .where(eq(connectionsTable.id, id))
        .run();

      return result.changes > 0;
    },
  };
}
