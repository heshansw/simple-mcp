import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConnectionConfig } from "@shared/schemas/connection.schema";
import { apiClient } from "@frontend/api/client";
import { connectionKeys } from "@frontend/api/query-keys";

export type CreateConnectionInput = Omit<
  ConnectionConfig,
  "id" | "status" | "createdAt" | "updatedAt"
>;

export type UpdateConnectionInput = Omit<
  ConnectionConfig,
  "createdAt" | "updatedAt"
>;

export function useConnections() {
  return useQuery({
    queryKey: connectionKeys.list(),
    queryFn: async () => {
      return apiClient.get<ConnectionConfig[]>("/connections");
    },
  });
}

export function useConnection(id: string) {
  return useQuery({
    queryKey: connectionKeys.detail(id),
    queryFn: async () => {
      return apiClient.get<ConnectionConfig>(`/connections/${id}`);
    },
  });
}

export function useCreateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateConnectionInput) => {
      return apiClient.post<ConnectionConfig>("/connections", input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: connectionKeys.list(),
      });
    },
  });
}

export function useUpdateConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateConnectionInput) => {
      return apiClient.put<ConnectionConfig>(
        `/connections/${input.id}`,
        input
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: connectionKeys.list(),
      });
      queryClient.invalidateQueries({
        queryKey: connectionKeys.detail(data.id),
      });
    },
  });
}

export function useDeleteConnection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.del<void>(`/connections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: connectionKeys.list(),
      });
    },
  });
}

// Credentials hooks

export function useCredentialStatus(connectionId: string) {
  return useQuery({
    queryKey: [...connectionKeys.detail(connectionId), "credentials"] as const,
    queryFn: async () => {
      return apiClient.get<{ hasCredentials: boolean }>(
        `/connections/${connectionId}/credentials/status`
      );
    },
  });
}

export function useStoreCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ connectionId, token }: { connectionId: string; token: string }) => {
      return apiClient.post<{ success: boolean; status: string }>(
        `/connections/${connectionId}/credentials`,
        { token }
      );
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: connectionKeys.list(),
      });
      queryClient.invalidateQueries({
        queryKey: connectionKeys.detail(variables.connectionId),
      });
      queryClient.invalidateQueries({
        queryKey: [...connectionKeys.detail(variables.connectionId), "credentials"] as const,
      });
    },
  });
}

export function useRemoveCredentials() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (connectionId: string) => {
      return apiClient.del<{ success: boolean }>(
        `/connections/${connectionId}/credentials`
      );
    },
    onSuccess: (_data, connectionId) => {
      queryClient.invalidateQueries({
        queryKey: connectionKeys.list(),
      });
      queryClient.invalidateQueries({
        queryKey: connectionKeys.detail(connectionId),
      });
      queryClient.invalidateQueries({
        queryKey: [...connectionKeys.detail(connectionId), "credentials"] as const,
      });
    },
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: async (connectionId: string) => {
      return apiClient.post<{ status: string }>(
        `/connections/${connectionId}/test`,
        {}
      );
    },
  });
}
