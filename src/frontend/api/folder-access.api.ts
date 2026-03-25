import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@frontend/api/client";
import { folderAccessKeys, workspaceKeys } from "@frontend/api/query-keys";

export type FolderAccessEntry = {
  id: string;
  name: string;
  absolutePath: string;
  allowedExtensions: string; // JSON stringified array
  maxFileSizeKb: number;
  recursive: number; // 0 | 1 from SQLite
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateFolderAccessInput = {
  name: string;
  absolutePath: string;
  allowedExtensions?: string[];
  maxFileSizeKb?: number;
  recursive?: boolean;
};

export type UpdateFolderAccessInput = {
  name?: string;
  allowedExtensions?: string[];
  maxFileSizeKb?: number;
  recursive?: boolean;
  status?: "active" | "disabled";
};

export function useFolderAccessList() {
  return useQuery({
    queryKey: folderAccessKeys.list(),
    queryFn: async () => {
      return apiClient.get<FolderAccessEntry[]>("/folder-access");
    },
  });
}

export function useCreateFolderAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateFolderAccessInput) => {
      return apiClient.post<FolderAccessEntry>("/folder-access", input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: folderAccessKeys.list() });
    },
  });
}

export function useUpdateFolderAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateFolderAccessInput }) => {
      return apiClient.patch<FolderAccessEntry>(`/folder-access/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: folderAccessKeys.list() });
    },
  });
}

export function useDeleteFolderAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.del<void>(`/folder-access/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: folderAccessKeys.list() });
      // Workspaces may have been cascade-deleted
      queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
    },
  });
}

export function useVerifyFolderAccess() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      return apiClient.post<{ id: string; status: string }>(
        `/folder-access/${id}/verify`,
        {}
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: folderAccessKeys.list() });
    },
  });
}
