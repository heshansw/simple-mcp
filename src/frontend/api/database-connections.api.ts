import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@frontend/api/client";
import { databaseConnectionKeys, databaseInsightsKeys } from "@frontend/api/query-keys";

// ── Types ───────────────────────────────────────────────────────────

export type DbPermissionRule = {
  schemaName: string;
  tables: string[];
};

export type DbPermissions = {
  allowedSchemas: DbPermissionRule[];
  allowWrites: boolean;
};

export type DatabaseConnectionEntry = {
  id: string;
  name: string;
  integrationType: "mysql" | "postgres";
  baseUrl: string;
  authMethod: string;
  status: string;
  databaseDialect: string | null;
  allowWrites: number;
  dbPermissions: string; // JSON
  createdAt: string;
  updatedAt: string;
};

export type CreateDatabaseConnectionInput = {
  name: string;
  dialect: "mysql" | "postgres";
  authMethod: "username_password" | "connection_string";
  permissions?: DbPermissions;
};

export type DbCredentialsUsernamePassword = {
  method: "username_password";
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
};

export type DbCredentialsConnectionString = {
  method: "connection_string";
  connectionString: string;
};

export type DbCredentials = DbCredentialsUsernamePassword | DbCredentialsConnectionString;

export type TestConnectionResult = {
  status: string;
  dialect?: string;
  latency_ms?: number;
  error?: string;
};

export type DbQueryActivityEntry = {
  id: string;
  connectionId: string;
  toolName: string;
  dialect: string;
  schemaName: string | null;
  tableName: string | null;
  sqlQuery: string | null;
  rowCount: number;
  resultSizeBytes: number;
  inputTokensEstimate: number;
  outputTokensEstimate: number;
  durationMs: number;
  success: number;
  errorTag: string | null;
  createdAt: string;
};

export type DbQueryInsightsStats = {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalRowsReturned: number;
  totalResultBytes: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  avgDurationMs: number;
  avgTokensPerCall: number;
  callsByTool: Record<string, number>;
  callsByConnection: Record<string, number>;
  callsByDialect: Record<string, number>;
  tokensByTool: Record<string, { input: number; output: number }>;
  topSchemas: Array<{ schema: string; count: number }>;
  topTables: Array<{ table: string; count: number }>;
  recentErrors: Array<{ toolName: string; errorTag: string; connectionId: string; createdAt: string }>;
};

// ── Hooks ───────────────────────────────────────────────────────────

export function useDatabaseConnectionsList() {
  return useQuery({
    queryKey: databaseConnectionKeys.list(),
    queryFn: () => apiClient.get<DatabaseConnectionEntry[]>("/database-connections"),
  });
}

export function useCreateDatabaseConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDatabaseConnectionInput) =>
      apiClient.post<DatabaseConnectionEntry>("/database-connections", input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: databaseConnectionKeys.list() });
    },
  });
}

export function useUpdateDatabasePermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: DbPermissions }) =>
      apiClient.patch<DatabaseConnectionEntry>(`/database-connections/${id}/permissions`, permissions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: databaseConnectionKeys.list() });
    },
  });
}

export function useStoreDatabaseCredentials() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, credentials }: { id: string; credentials: DbCredentials }) =>
      apiClient.post<void>(`/database-connections/${id}/credentials`, credentials),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: databaseConnectionKeys.list() });
    },
  });
}

export function useTestDatabaseConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<TestConnectionResult>(`/database-connections/${id}/test`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: databaseConnectionKeys.list() });
    },
  });
}

export function useDeleteDatabaseConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del<void>(`/connections/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: databaseConnectionKeys.list() });
    },
  });
}

// ── Insights ────────────────────────────────────────────────────────

export function useDatabaseInsightsActivity(connectionId?: string) {
  return useQuery({
    queryKey: databaseInsightsKeys.activity(connectionId),
    queryFn: () => {
      const params = connectionId ? `?connection_id=${connectionId}` : "";
      return apiClient.get<DbQueryActivityEntry[]>(`/database-insights/activity${params}`);
    },
  });
}

export function useDatabaseInsightsStats() {
  return useQuery({
    queryKey: databaseInsightsKeys.stats(),
    queryFn: () => apiClient.get<DbQueryInsightsStats>("/database-insights/stats"),
  });
}
