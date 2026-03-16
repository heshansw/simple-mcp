import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ServerSettings } from "@shared/schemas/server.schema";
import { apiClient } from "@frontend/api/client";
import { settingsKeys } from "@frontend/api/query-keys";

export type UpdateServerSettingsInput = ServerSettings;

export function useServerSettings() {
  return useQuery({
    queryKey: settingsKeys.server(),
    queryFn: async () => {
      return apiClient.get<ServerSettings>("/settings");
    },
  });
}

export function useUpdateServerSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateServerSettingsInput) => {
      return apiClient.put<ServerSettings>("/settings", input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: settingsKeys.server(),
      });
    },
  });
}
