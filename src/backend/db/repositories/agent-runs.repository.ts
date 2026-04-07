import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { agentRunsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type AgentRun = typeof agentRunsTable.$inferSelect;
export type NewAgentRun = typeof agentRunsTable.$inferInsert;

export interface AgentRunsRepository {
  create(data: {
    id?: string;
    agentId: string;
    goal: string;
    status: string;
    config: string;
    parentRunId?: string | null;
    startedAt: string;
    createdAt: string;
  }): Promise<AgentRun>;

  findById(id: string): Promise<AgentRun | undefined>;

  findByAgentId(agentId: string, limit?: number): Promise<readonly AgentRun[]>;

  findRecent(limit?: number): Promise<readonly AgentRun[]>;

  update(
    id: string,
    data: Partial<Omit<NewAgentRun, "id" | "createdAt">>
  ): Promise<AgentRun | undefined>;
}

export function createAgentRunsRepository(db: DrizzleDB): AgentRunsRepository {
  return {
    async create(data) {
      const id = data.id ?? randomUUID();
      const row: NewAgentRun = {
        id,
        agentId: data.agentId,
        goal: data.goal,
        status: data.status,
        config: data.config,
        parentRunId: data.parentRunId ?? null,
        startedAt: data.startedAt,
        createdAt: data.createdAt,
      };
      await db.insert(agentRunsTable).values(row);
      const results = await db
        .select()
        .from(agentRunsTable)
        .where(eq(agentRunsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created agent run");
      return results[0];
    },

    async findById(id: string) {
      const results = await db
        .select()
        .from(agentRunsTable)
        .where(eq(agentRunsTable.id, id));
      return results[0];
    },

    async findByAgentId(agentId: string, limit = 50) {
      return db
        .select()
        .from(agentRunsTable)
        .where(eq(agentRunsTable.agentId, agentId))
        .orderBy(desc(agentRunsTable.createdAt))
        .limit(limit);
    },

    async findRecent(limit = 50) {
      return db
        .select()
        .from(agentRunsTable)
        .orderBy(desc(agentRunsTable.createdAt))
        .limit(limit);
    },

    async update(id, data) {
      await db
        .update(agentRunsTable)
        .set(data)
        .where(eq(agentRunsTable.id, id));
      const results = await db
        .select()
        .from(agentRunsTable)
        .where(eq(agentRunsTable.id, id));
      return results[0];
    },
  };
}
