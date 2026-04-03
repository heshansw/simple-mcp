import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { agentTasksTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type AgentTask = typeof agentTasksTable.$inferSelect;
export type NewAgentTask = typeof agentTasksTable.$inferInsert;

export interface AgentTasksRepository {
  create(data: {
    id?: string;
    runId: string;
    description: string;
    dependsOn?: string;
    requiredTools?: string;
    status?: string;
    createdAt: string;
  }): Promise<AgentTask>;

  findByRunId(runId: string): Promise<readonly AgentTask[]>;

  update(
    id: string,
    data: Partial<Omit<NewAgentTask, "id" | "createdAt">>
  ): Promise<AgentTask | undefined>;

  bulkCreate(
    tasks: readonly {
      runId: string;
      description: string;
      dependsOn?: string;
      requiredTools?: string;
      createdAt: string;
    }[]
  ): Promise<readonly AgentTask[]>;
}

export function createAgentTasksRepository(
  db: DrizzleDB
): AgentTasksRepository {
  return {
    async create(data) {
      const id = data.id ?? randomUUID();
      const now = data.createdAt;
      const row: NewAgentTask = {
        id,
        runId: data.runId,
        description: data.description,
        dependsOn: data.dependsOn ?? "[]",
        requiredTools: data.requiredTools ?? "[]",
        status: data.status ?? "pending",
        createdAt: now,
      };
      await db.insert(agentTasksTable).values(row);
      const results = await db
        .select()
        .from(agentTasksTable)
        .where(eq(agentTasksTable.id, id));
      if (!results[0])
        throw new Error("Failed to retrieve created agent task");
      return results[0];
    },

    async findByRunId(runId: string) {
      return db
        .select()
        .from(agentTasksTable)
        .where(eq(agentTasksTable.runId, runId));
    },

    async update(id, data) {
      await db
        .update(agentTasksTable)
        .set(data)
        .where(eq(agentTasksTable.id, id));
      const results = await db
        .select()
        .from(agentTasksTable)
        .where(eq(agentTasksTable.id, id));
      return results[0];
    },

    async bulkCreate(tasks) {
      const now = new Date().toISOString();
      const created: AgentTask[] = [];
      for (const task of tasks) {
        const id = randomUUID();
        const row: NewAgentTask = {
          id,
          runId: task.runId,
          description: task.description,
          dependsOn: task.dependsOn ?? "[]",
          requiredTools: task.requiredTools ?? "[]",
          status: "pending",
          createdAt: task.createdAt || now,
        };
        await db.insert(agentTasksTable).values(row);
        const results = await db
          .select()
          .from(agentTasksTable)
          .where(eq(agentTasksTable.id, id));
        if (results[0]) {
          created.push(results[0]);
        }
      }
      return created;
    },
  };
}
