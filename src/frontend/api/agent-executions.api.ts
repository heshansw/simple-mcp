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
