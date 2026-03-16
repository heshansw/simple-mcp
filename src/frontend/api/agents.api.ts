import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AgentConfig,
  AgentDefinition,
} from "@shared/schemas/agent.schema";
import { apiClient } from "@frontend/api/client";
import { agentKeys } from "@frontend/api/query-keys";

export type UpdateAgentConfigInput = AgentConfig;

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.list(),
    queryFn: async () => {
      return apiClient.get<AgentDefinition[]>("/agents");
    },
  });
}

export function useAgent(id: string) {
  return useQuery({
    queryKey: agentKeys.detail(id),
    queryFn: async () => {
      return apiClient.get<AgentDefinition>(`/agents/${id}`);
    },
  });
}

export function useAgentConfig(agentId: string) {
  return useQuery({
    queryKey: [...agentKeys.detail(agentId), "config"] as const,
    queryFn: async () => {
      return apiClient.get<AgentConfig>(`/agents/${agentId}/config`);
    },
  });
}

export function useUpdateAgentConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateAgentConfigInput) => {
      return apiClient.put<AgentConfig>(
        `/agents/${input.agentId}/config`,
        input
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: agentKeys.list(),
      });
      queryClient.invalidateQueries({
        queryKey: agentKeys.detail(data.agentId),
      });
      queryClient.invalidateQueries({
        queryKey: [
          ...agentKeys.detail(data.agentId),
          "config",
        ] as const,
      });
    },
  });
}
