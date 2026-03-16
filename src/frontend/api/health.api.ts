import { useQuery } from "@tanstack/react-query";
import type { ServerHealth } from "@shared/schemas/server.schema";
import { apiClient } from "@frontend/api/client";
import { healthKeys } from "@frontend/api/query-keys";

export function useServerHealth() {
  return useQuery({
    queryKey: healthKeys.status(),
    queryFn: async () => {
      return apiClient.get<ServerHealth>("/health");
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  });
}
