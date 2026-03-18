import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { agentConfigsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type AgentConfigRow = typeof agentConfigsTable.$inferSelect;
export type NewAgentConfigRow = typeof agentConfigsTable.$inferInsert;

/** Parsed agent config with deserialized JSON fields */
export type AgentConfig = Omit<AgentConfigRow, "parameterOverrides" | "linkedConnectionIds" | "enabled"> & {
  enabled: boolean;
  parameterOverrides: Record<string, unknown>;
  linkedConnectionIds: string[];
};

export type UpsertAgentConfigInput = {
  enabled?: boolean;
  parameterOverrides?: Record<string, unknown>;
  linkedConnectionIds?: string[];
};

export interface AgentConfigsRepository {
  findAll(): Promise<AgentConfig[]>;
  findByAgentId(agentId: string): Promise<AgentConfig | undefined>;
  upsert(
    agentId: string,
    data: UpsertAgentConfigInput
  ): Promise<AgentConfig>;
  delete(id: string): Promise<boolean>;
}

function deserializeRow(row: AgentConfigRow): AgentConfig {
  return {
    id: row.id,
    agentId: row.agentId,
    enabled: row.enabled === 1,
    parameterOverrides: JSON.parse(row.parameterOverrides || "{}") as Record<string, unknown>,
    linkedConnectionIds: JSON.parse(row.linkedConnectionIds || "[]") as string[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createAgentConfigsRepository(
  db: DrizzleDB
): AgentConfigsRepository {
  return {
    async findAll(): Promise<AgentConfig[]> {
      const rows = await db.select().from(agentConfigsTable);
      return rows.map(deserializeRow);
    },

    async findByAgentId(agentId: string): Promise<AgentConfig | undefined> {
      const results = await db
        .select()
        .from(agentConfigsTable)
        .where(eq(agentConfigsTable.agentId, agentId));
      const row = results[0];
      return row ? deserializeRow(row) : undefined;
    },

    async upsert(
      agentId: string,
      data: UpsertAgentConfigInput
    ): Promise<AgentConfig> {
      const now = new Date().toISOString();

      // Serialize JS objects to JSON strings for TEXT columns
      const serialized = {
        enabled: data.enabled ? 1 : 0,
        parameterOverrides: JSON.stringify(data.parameterOverrides ?? {}),
        linkedConnectionIds: JSON.stringify(data.linkedConnectionIds ?? []),
      };

      const existingResults = await db
        .select()
        .from(agentConfigsTable)
        .where(eq(agentConfigsTable.agentId, agentId));

      const existing = existingResults[0];

      if (existing) {
        await db
          .update(agentConfigsTable)
          .set({
            ...serialized,
            updatedAt: now,
          })
          .where(eq(agentConfigsTable.agentId, agentId));

        const updatedResults = await db
          .select()
          .from(agentConfigsTable)
          .where(eq(agentConfigsTable.agentId, agentId));

        const updated = updatedResults[0];

        if (!updated) {
          throw new Error(
            `Failed to retrieve updated agent config for agentId ${agentId}`
          );
        }

        return deserializeRow(updated);
      }

      const id = randomUUID();

      await db.insert(agentConfigsTable).values({
        id,
        agentId,
        ...serialized,
        createdAt: now,
        updatedAt: now,
      });

      const createdResults = await db
        .select()
        .from(agentConfigsTable)
        .where(eq(agentConfigsTable.id, id));

      const created = createdResults[0];

      if (!created) {
        throw new Error(
          `Failed to retrieve created agent config with id ${id}`
        );
      }

      return deserializeRow(created);
    },

    async delete(id: string): Promise<boolean> {
      await db
        .delete(agentConfigsTable)
        .where(eq(agentConfigsTable.id, id));

      return true;
    },
  };
}
