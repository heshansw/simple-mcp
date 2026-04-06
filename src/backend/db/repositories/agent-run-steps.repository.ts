import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { agentRunStepsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type AgentRunStep = typeof agentRunStepsTable.$inferSelect;
export type NewAgentRunStep = typeof agentRunStepsTable.$inferInsert;

export type AgentRunStepsRepository = {
  readonly create: (data: Omit<NewAgentRunStep, "id">) => Promise<AgentRunStep>;
  readonly findByRunId: (
    runId: string,
    options?: { offset?: number; limit?: number }
  ) => Promise<{ steps: readonly AgentRunStep[]; total: number }>;
  readonly getNextStepIndex: (runId: string) => Promise<number>;
  readonly countByRunId: (runId: string) => Promise<number>;
};

const MAX_TOOL_ARGS_LENGTH = 2000;
const MAX_TOOL_RESULT_LENGTH = 4000;
const MAX_REASONING_LENGTH = 4000;

/** Truncate a string to maxLength, appending "[...truncated]" if clipped. */
function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (value == null) return null;
  if (value.length <= maxLength) return value;
  return value.substring(0, maxLength - 15) + " [...truncated]";
}

export function createAgentRunStepsRepository(
  db: DrizzleDB
): AgentRunStepsRepository {
  return {
    async create(data) {
      const id = randomUUID();
      const row: NewAgentRunStep = {
        id,
        runId: data.runId,
        stepIndex: data.stepIndex ?? 0,
        stepType: data.stepType,
        toolName: data.toolName ?? null,
        toolArgs: truncate(data.toolArgs, MAX_TOOL_ARGS_LENGTH),
        toolResult: truncate(data.toolResult, MAX_TOOL_RESULT_LENGTH),
        toolIsError: data.toolIsError ?? null,
        delegateTargetAgentId: data.delegateTargetAgentId ?? null,
        delegateChildRunId: data.delegateChildRunId ?? null,
        reasoning: truncate(data.reasoning, MAX_REASONING_LENGTH),
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        durationMs: data.durationMs ?? 0,
        createdAt: data.createdAt ?? new Date().toISOString(),
      };
      await db.insert(agentRunStepsTable).values(row);
      const results = await db
        .select()
        .from(agentRunStepsTable)
        .where(eq(agentRunStepsTable.id, id));
      if (!results[0]) throw new Error("Failed to retrieve created step");
      return results[0];
    },

    async findByRunId(runId, options) {
      const offset = options?.offset ?? 0;
      const limit = options?.limit ?? 100;

      const [steps, countResult] = await Promise.all([
        db
          .select()
          .from(agentRunStepsTable)
          .where(eq(agentRunStepsTable.runId, runId))
          .orderBy(agentRunStepsTable.stepIndex)
          .offset(offset)
          .limit(limit),
        db
          .select({ count: sql<number>`count(*)` })
          .from(agentRunStepsTable)
          .where(eq(agentRunStepsTable.runId, runId)),
      ]);

      return {
        steps,
        total: countResult[0]?.count ?? 0,
      };
    },

    async getNextStepIndex(runId) {
      const result = await db
        .select({ maxIndex: sql<number>`coalesce(max(step_index), -1)` })
        .from(agentRunStepsTable)
        .where(eq(agentRunStepsTable.runId, runId));
      return (result[0]?.maxIndex ?? -1) + 1;
    },

    async countByRunId(runId) {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(agentRunStepsTable)
        .where(eq(agentRunStepsTable.runId, runId));
      return result[0]?.count ?? 0;
    },
  };
}
