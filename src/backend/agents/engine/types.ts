import type { AgentId, AgentRunId, AgentTaskId } from "@shared/types";

// ── Execution state machine (discriminated union) ──────────────────────

export type AgentRunState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Planning"; readonly goal: string }
  | { readonly _tag: "Executing"; readonly currentTaskId: AgentTaskId | null; readonly iteration: number }
  | { readonly _tag: "AwaitingToolResult"; readonly toolName: string; readonly callId: string }
  | { readonly _tag: "Reflecting"; readonly observation: string }
  | { readonly _tag: "Delegating"; readonly targetAgentId: AgentId; readonly subGoal: string }
  | { readonly _tag: "Completed"; readonly result: AgentRunResult }
  | { readonly _tag: "Failed"; readonly errorMessage: string; readonly phase: ExecutionPhase }
  | { readonly _tag: "Cancelled"; readonly reason: string };

export type ExecutionPhase = "planning" | "execution" | "reflection" | "delegation";

// ── Run configuration ──────────────────────────────────────────────────

export type AgentRunConfig = {
  readonly maxIterations: number;
  readonly maxToolCalls: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly model: string;
  readonly maxDelegationDepth: number;
  readonly observationSummaryThreshold: number;
};

export const DEFAULT_RUN_CONFIG: AgentRunConfig = {
  maxIterations: 25,
  maxToolCalls: 100,
  maxTokens: 200_000,
  timeoutMs: 5 * 60 * 1000, // 5 minutes
  model: "claude-sonnet-4-20250514",
  maxDelegationDepth: 2,
  observationSummaryThreshold: 4000,
} as const;

// ── Run result ─────────────────────────────────────────────────────────

export type AgentRunResult = {
  readonly runId: AgentRunId;
  readonly agentId: AgentId;
  readonly goal: string;
  readonly answer: string;
  readonly tasksCompleted: number;
  readonly toolCallsMade: number;
  readonly iterationsUsed: number;
  readonly inputTokensUsed: number;
  readonly outputTokensUsed: number;
  readonly durationMs: number;
};

// ── Run status (for querying in-progress or completed runs) ────────────

export type AgentRunStatus = {
  readonly runId: AgentRunId;
  readonly agentId: AgentId;
  readonly goal: string;
  readonly state: AgentRunState["_tag"];
  readonly iterationCount: number;
  readonly toolCallCount: number;
  readonly inputTokensUsed: number;
  readonly outputTokensUsed: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly errorMessage: string | null;
  readonly result: string | null;
};

// ── Tool invocation record ─────────────────────────────────────────────

export type ToolInvocation = {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly result: string;
  readonly durationMs: number;
  readonly isError: boolean;
};

// ── Planned task within a run ──────────────────────────────────────────

export type PlannedTaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped";

export type PlannedTask = {
  readonly id: AgentTaskId;
  readonly description: string;
  readonly dependsOn: readonly AgentTaskId[];
  readonly requiredTools: readonly string[];
  readonly status: PlannedTaskStatus;
};

export type TaskPlan = {
  readonly tasks: readonly PlannedTask[];
};

// ── Guardrail limits ───────────────────────────────────────────────────

export type GuardrailLimits = {
  readonly maxIterations: number;
  readonly maxToolCalls: number;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly maxConsecutiveDuplicateCalls: number;
};

export const DEFAULT_GUARDRAIL_LIMITS: GuardrailLimits = {
  maxIterations: 25,
  maxToolCalls: 100,
  maxTokens: 200_000,
  timeoutMs: 5 * 60 * 1000,
  maxConsecutiveDuplicateCalls: 3,
} as const;

// ── Tool handler shape (matches MCP tool handler result) ───────────────

export type ToolContentBlock = {
  readonly type: "text";
  readonly text: string;
};

export type ToolHandlerResult = {
  readonly content: readonly ToolContentBlock[];
  readonly isError?: boolean;
};

export type ToolHandler = (
  args: Record<string, unknown>
) => Promise<ToolHandlerResult>;

// ── Tool schema entry in the registry ──────────────────────────────────

export type ToolSchemaEntry = {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly handler: ToolHandler;
};
