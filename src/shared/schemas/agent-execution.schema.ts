import { z } from "zod";

export const AgentRunConfigSchema = z.object({
  maxIterations: z.number().int().positive().max(50).default(25),
  maxToolCalls: z.number().int().positive().max(500).default(100),
  maxTokens: z.number().int().positive().max(1_000_000).default(200_000),
  timeoutMs: z.number().int().positive().max(30 * 60 * 1000).default(5 * 60 * 1000),
  model: z.string().min(1).default("claude-sonnet-4-20250514"),
  maxDelegationDepth: z.number().int().min(0).max(5).default(2),
  observationSummaryThreshold: z.number().int().positive().default(4000),
});

export type AgentRunConfigInput = z.infer<typeof AgentRunConfigSchema>;

export const AgentExecuteInputSchema = z.object({
  agentId: z.string().min(1).describe("The agent ID to execute"),
  goal: z.string().min(1).describe("The goal for the agent to accomplish"),
  config: AgentRunConfigSchema.partial().optional().describe("Optional execution config overrides"),
});

export type AgentExecuteInput = z.infer<typeof AgentExecuteInputSchema>;

export const AGENT_RUN_STATUSES = [
  "planning",
  "executing",
  "completed",
  "failed",
  "cancelled",
] as const;

export type AgentRunStatusValue = (typeof AGENT_RUN_STATUSES)[number];

export const AgentRunStatusSchema = z.object({
  runId: z.string().min(1),
  agentId: z.string().min(1),
  goal: z.string(),
  status: z.enum(AGENT_RUN_STATUSES),
  iterationCount: z.number().int().min(0),
  toolCallCount: z.number().int().min(0),
  inputTokensUsed: z.number().int().min(0),
  outputTokensUsed: z.number().int().min(0),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
  result: z.string().nullable(),
});

export type AgentRunStatusOutput = z.infer<typeof AgentRunStatusSchema>;

export const AGENT_TASK_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "skipped",
] as const;

export type AgentTaskStatusValue = (typeof AGENT_TASK_STATUSES)[number];

export const AgentTaskSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  description: z.string(),
  dependsOn: z.array(z.string()).default([]),
  requiredTools: z.array(z.string()).default([]),
  status: z.enum(AGENT_TASK_STATUSES),
  result: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export type AgentTaskOutput = z.infer<typeof AgentTaskSchema>;
