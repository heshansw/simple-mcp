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
