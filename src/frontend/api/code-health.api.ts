import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client.js";
import { codeHealthKeys } from "./query-keys.js";

// Types matching backend response shapes
export type CodeHealthProject = {
  id: string;
  name: string;
  directoryPath: string;
  latestScore: number | null;
  latestGrade: string | null;
  fileCount: number;
  lastAnalyzedAt: string | null;
};

export type CodeHealthSnapshot = {
  id: string;
  directoryPath: string;
  overallScore: number;
  grade: string;
  fileCount: number;
  totalLoc: number;
  totalFunctions: number;
  avgCyclomatic: number;
  avgCognitive: number;
  duplicationPct: number;
  typeCoveragePct: number | null;
  gitRef: string | null;
  label: string | null;
  createdAt: string;
};

export type CodeHealthFileMetric = {
  id: string;
  filePath: string;
  relativePath: string;
  language: string;
  score: number;
  grade: string;
  loc: number;
  functionCount: number;
  avgCyclomatic: number;
  maxCyclomatic: number;
  maintainabilityIndex: number;
  nestingDepthMax: number;
  issuesJson: string;
};

export type CodeHealthTrendPoint = {
  date: string;
  score: number;
  grade: string;
  fileCount?: number;
};

export type CodeHealthSession = {
  id: string;
  directoryPath: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  filesChanged: string; // JSON array
  totalIterations: number;
  targetScore: number;
  achievedTarget: number;
  initialScoresJson: string;
  finalScoresJson: string;
};

export type CodeHealthEvent = {
  id: string;
  eventType: string;
  filePath: string | null;
  beforeScore: number | null;
  afterScore: number | null;
  issuesFound: number;
  issuesResolved: number;
  iterations: number;
  trigger: string;
  createdAt: string;
};

// Query hooks
export function useCodeHealthProjects() {
  return useQuery({
    queryKey: codeHealthKeys.projects(),
    queryFn: () => apiClient.get<CodeHealthProject[]>("/code-health/projects"),
  });
}

export function useCodeHealthProject(id: string) {
  return useQuery({
    queryKey: codeHealthKeys.project(id),
    queryFn: () => apiClient.get<{ project: CodeHealthProject; snapshot: CodeHealthSnapshot | null }>(`/code-health/projects/${id}`),
    enabled: !!id,
  });
}

export function useCodeHealthTrends(projectId: string) {
  return useQuery({
    queryKey: codeHealthKeys.trends(projectId),
    queryFn: () => apiClient.get<CodeHealthTrendPoint[]>(`/code-health/projects/${projectId}/trends`),
    enabled: !!projectId,
  });
}

export function useCodeHealthFiles(snapshotId: string) {
  return useQuery({
    queryKey: codeHealthKeys.files(snapshotId),
    queryFn: () => apiClient.get<CodeHealthFileMetric[]>(`/code-health/snapshots/${snapshotId}/files`),
    enabled: !!snapshotId,
  });
}

export function useCodeHealthSessions() {
  return useQuery({
    queryKey: codeHealthKeys.sessions(),
    queryFn: () => apiClient.get<CodeHealthSession[]>("/code-health/sessions"),
  });
}

export function useCodeHealthEvents(projectId: string) {
  return useQuery({
    queryKey: codeHealthKeys.events(projectId),
    queryFn: () => apiClient.get<CodeHealthEvent[]>(`/code-health/projects/${projectId}/events`),
    enabled: !!projectId,
  });
}

export function useTriggerSnapshot() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => apiClient.post<{ snapshotId: string }>(`/code-health/projects/${projectId}/snapshot`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: codeHealthKeys.all });
    },
  });
}

// Background jobs
export type BackgroundJob = {
  id: string;
  filePath: string;
  workspaceId: string | null;
  status: string;
  score: number | null;
  grade: string | null;
  issueCount: number;
  issuesJson: string;
  triggerTool: string;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type HealthIssue = {
  severity: "critical" | "warning" | "info";
  signal: string;
  message: string;
  filePath?: string;
  line?: number;
  functionName?: string;
  suggestion?: string;
};

export function useBackgroundJobs() {
  return useQuery({
    queryKey: codeHealthKeys.backgroundJobs(),
    queryFn: () => apiClient.get<BackgroundJob[]>("/code-health/background-jobs"),
    refetchInterval: 10_000,
  });
}

export function useProjectScannedFiles(projectId: string) {
  return useQuery({
    queryKey: codeHealthKeys.scannedFiles(projectId),
    queryFn: () => apiClient.get<BackgroundJob[]>(`/code-health/projects/${projectId}/scanned-files`),
    enabled: !!projectId,
    refetchInterval: 15_000,
  });
}

export function useActiveBackgroundJobCount() {
  return useQuery({
    queryKey: codeHealthKeys.backgroundJobsActive(),
    queryFn: () => apiClient.get<{ count: number }>("/code-health/background-jobs/active"),
    refetchInterval: 10_000,
  });
}
