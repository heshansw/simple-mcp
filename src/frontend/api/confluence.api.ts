import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@frontend/api/client";

// ── Query keys ───────────────────────────────────────────────────────

export const confluenceKeys = {
  all: ["confluence"] as const,
  settings: () => [...confluenceKeys.all, "settings"] as const,
  activity: () => [...confluenceKeys.all, "activity"] as const,
  insights: () => [...confluenceKeys.all, "insights"] as const,
};

// ── Types ────────────────────────────────────────────────────────────

export type ConfluenceSettings = {
  allowedSpaceKeys: string[];
};

export type ConfluenceActivityEntry = {
  id: string;
  toolName: string;
  spaceKey: string | null;
  pageId: string | null;
  cql: string | null;
  resultCount: number;
  contentSizeBytes: number;
  durationMs: number;
  success: number;
  errorTag: string | null;
  createdAt: string;
};

export type ConfluenceInsights = {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalContentBytes: number;
  totalResultsReturned: number;
  avgDurationMs: number;
  callsByTool: Record<string, number>;
  callsBySpace: Record<string, number>;
  recentErrors: Array<{ toolName: string; errorTag: string; createdAt: string }>;
};

// ── Hooks ────────────────────────────────────────────────────────────

export function useConfluenceSettings() {
  return useQuery({
    queryKey: confluenceKeys.settings(),
    queryFn: () => apiClient.get<ConfluenceSettings>("/confluence/settings"),
  });
}

export function useUpdateConfluenceSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: ConfluenceSettings) =>
      apiClient.put<ConfluenceSettings>("/confluence/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: confluenceKeys.settings() });
    },
  });
}

export function useConfluenceActivity(limit = 50) {
  return useQuery({
    queryKey: [...confluenceKeys.activity(), limit] as const,
    queryFn: () =>
      apiClient.get<ConfluenceActivityEntry[]>(`/confluence/activity?limit=${limit}`),
    refetchInterval: 30_000, // refresh every 30s
  });
}

export function useConfluenceInsights() {
  return useQuery({
    queryKey: confluenceKeys.insights(),
    queryFn: () => apiClient.get<ConfluenceInsights>("/confluence/insights"),
    refetchInterval: 30_000,
  });
}
