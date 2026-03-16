import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { agentConfigsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type AgentConfig = typeof agentConfigsTable.$inferSelect;
export type NewAgentConfig = typeof agentConfigsTable.$inferInsert;

export interface AgentConfigsRepository {
  findAll(): AgentConfig[];
  findByAgentId(agentId: string): AgentConfig | undefined;
  upsert(
    agentId: string,
    data: Omit<NewAgentConfig, "id" | "agentId" | "createdAt" | "updatedAt">
  ): AgentConfig;
  delete(id: string): boolean;
}

export function createAgentConfigsRepository(
  db: DrizzleDB
): AgentConfigsRepository {
  return {
    findAll(): AgentConfig[] {
      return db.select().from(agentConfigsTable).all();
    },

    findByAgentId(agentId: string): AgentConfig | undefined {
      return db
        .select()
        .from(agentConfigsTable)
        .where(eq(agentConfigsTable.agentId, agentId))
        .get();
    },

    upsert(
      agentId: string,
      data: Omit<NewAgentConfig, "id" | "createdAt" | "updatedAt">
    ): AgentConfig {
      const now = new Date().toISOString();

      const existing = db
        .select()
        .from(agentConfigsTable)
        .where(eq(agentConfigsTable.agentId, agentId))
        .get();

      if (existing) {
        db.update(agentConfigsTable)
          .set({
            ...data,
            updatedAt: now,
          })
          .where(eq(agentConfigsTable.agentId, agentId))
          .run();

        const updated = db
          .select()
          .from(agentConfigsTable)
          .where(eq(agentConfigsTable.agentId, agentId))
          .get();

        if (!updated) {
          throw new Error(
            `Failed to retrieve updated agent config for agentId ${agentId}`
          );
        }

        return updated;
      }

      const id = randomUUID();

      const newConfig: NewAgentConfig = {
        ...data,
        id,
        agentId,
        createdAt: now,
        updatedAt: now,
      };

      db.insert(agentConfigsTable).values(newConfig).run();

      const created = db
        .select()
        .from(agentConfigsTable)
        .where(eq(agentConfigsTable.id, id))
        .get();

      if (!created) {
        throw new Error(
          `Failed to retrieve created agent config with id ${id}`
        );
      }

      return created;
    },

    delete(id: string): boolean {
      const result = db
        .delete(agentConfigsTable)
        .where(eq(agentConfigsTable.id, id))
        .run();

      return result.changes > 0;
    },
  };
}
