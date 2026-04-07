import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@frontend/api/client";
import { agentExecutionKeys } from "@frontend/api/query-keys";

// ── Types ───────────────────────────────────────────────────────────

export type AgentRunListItem = {
  id: string;
  agentId: string;
  goal: string;
  status: string;
  result: string | null;
  config: string;
  iterationCount: number;
  toolCallCount: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
  parentRunId: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
};

export type AgentRunDetail = {
  runId: string;
  agentId: string;
  goal: string;
  state: string;
  iterationCount: number;
  toolCallCount: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  result: string | null;
};

export type AgentRunResult = {
  runId: string;
  agentId: string;
  goal: string;
  answer: string;
  tasksCompleted: number;
  toolCallsMade: number;
  iterationsUsed: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
  durationMs: number;
};

export type ExecuteAgentInput = {
  agentId: string;
  goal: string;
  config?: {
    maxIterations?: number;
    maxToolCalls?: number;
    maxTokens?: number;
  };
};

export type AgentRunStepItem = {
  id: string;
  runId: string;
  stepIndex: number;
  stepType: string;
  toolName: string | null;
  toolArgs: string | null;
  toolResult: string | null;
  toolIsError: number | null;
  delegateTargetAgentId: string | null;
  delegateChildRunId: string | null;
  reasoning: string | null;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  createdAt: string;
};

export type AgentRunStepsResponse = {
  steps: AgentRunStepItem[];
  total: number;
};

export type DelegationNode = {
  run: {
    id: string;
    agentId: string;
    goal: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
  };
  children: DelegationNode[];
};

export type AgentExecutionStats = {
  totalRuns: number;
  activeRuns: number;
  successRate: number;
  avgDurationMs: number;
  totalTokens: number;
  agentUsage: Array<{
    agentId: string;
    agentName: string;
    totalRuns: number;
    successRate: number;
    avgDurationMs: number;
    avgTokensPerRun: number;
    lastRunAt: string;
  }>;
};

export type TaskItem = {
  id: string;
  description: string;
  status: string;
  dependsOn: string;
  requiredTools: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type DelegatedRunItem = {
  id: string;
  agentId: string;
  agentName: string;
  goal: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
};

export type TaskProgressRun = {
  id: string;
  agentId: string;
  agentName: string;
  goal: string;
  status: string;
  iterationCount: number;
  toolCallCount: number;
  inputTokensUsed: number;
  outputTokensUsed: number;
  startedAt: string;
  completedAt: string | null;
  errorMessage: string | null;
  tasks: TaskItem[];
  delegatedRuns: DelegatedRunItem[];
};

// ── Query Hooks ─────────────────────────────────────────────────────

export function useAgentExecutions(filters?: { agentId?: string; limit?: number }) {
  const limit = filters?.limit ?? 50;
  const agentId = filters?.agentId;

  return useQuery({
    queryKey: agentExecutionKeys.list(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (agentId) {
        params.set("agentId", agentId);
      }
      return apiClient.get<AgentRunListItem[]>(`/agent-runs?${params.toString()}`);
    },
  });
}

export function useAgentExecution(runId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: agentExecutionKeys.detail(runId),
    queryFn: () => apiClient.get<AgentRunDetail>(`/agent-runs/${runId}`),
    enabled: options?.enabled ?? true,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.state === "planning" || data.state === "executing")) {
        return 3000;
      }
      return false;
    },
  });
}

export function useAgentRunSteps(
  runId: string,
  options?: { offset?: number; limit?: number; enabled?: boolean; refetchInterval?: number | false }
) {
  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 200;

  return useQuery({
    queryKey: agentExecutionKeys.steps(runId, offset),
    queryFn: () =>
      apiClient.get<AgentRunStepsResponse>(
        `/agent-runs/${runId}/steps?offset=${offset}&limit=${limit}`
      ),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useDelegationTree(runId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: agentExecutionKeys.delegationTree(runId),
    queryFn: () => apiClient.get<DelegationNode>(`/agent-runs/${runId}/delegation-tree`),
    enabled: options?.enabled ?? true,
  });
}

export function useAgentExecutionStats() {
  return useQuery({
    queryKey: agentExecutionKeys.stats(),
    queryFn: () => apiClient.get<AgentExecutionStats>("/agent-runs/stats"),
  });
}

export function useTaskProgress(filters?: { status?: string }) {
  return useQuery({
    queryKey: agentExecutionKeys.taskProgress(filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      const qs = params.toString();
      return apiClient.get<TaskProgressRun[]>(`/agent-runs/task-progress${qs ? `?${qs}` : ""}`);
    },
    refetchInterval: 5000,
  });
}

export function useRunTasks(runId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: agentExecutionKeys.tasks(runId),
    queryFn: () => apiClient.get<TaskItem[]>(`/agent-runs/${runId}/tasks`),
    enabled: options?.enabled ?? true,
  });
}

// ── Mutation Hooks ──────────────────────────────────────────────────

export function useExecuteAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: ExecuteAgentInput) =>
      apiClient.post<AgentRunResult>("/agent-runs/execute", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentExecutionKeys.lists() });
    },
  });
}

export function useCancelAgentRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: string) =>
      apiClient.post<{ success: boolean }>(`/agent-runs/${runId}/cancel`, {}),
    onSuccess: (_data, runId) => {
      queryClient.invalidateQueries({ queryKey: agentExecutionKeys.detail(runId) });
      queryClient.invalidateQueries({ queryKey: agentExecutionKeys.lists() });
    },
  });
}
