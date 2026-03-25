import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@frontend/api/client";
import { workspaceKeys } from "@frontend/api/query-keys";

export type WorkspaceEntry = {
  id: string;
  name: string;
  description: string;
  folderIds: string; // JSON stringified array
  createdAt: string;
  updatedAt: string;
};

export type CreateWorkspaceInput = {
  name: string;
  description?: string;
  folderIds: string[];
};

export type UpdateWorkspaceInput = {
  name?: string;
  description?: string;
  folderIds?: string[];
};

export function useWorkspacesList() {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: async () => {
      return apiClient.get<WorkspaceEntry[]>("/repo-workspaces");
    },
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateWorkspaceInput) => {
      return apiClient.post<WorkspaceEntry>("/repo-workspaces", input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
    },
  });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateWorkspaceInput }) => {
      return apiClient.patch<WorkspaceEntry>(`/repo-workspaces/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
    },
  });
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.del<void>(`/repo-workspaces/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
    },
  });
}
