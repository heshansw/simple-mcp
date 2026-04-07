export const connectionKeys = {
  all: ["connections"] as const,
  lists: () => [...connectionKeys.all, "list"] as const,
  list: () => connectionKeys.lists(),
  details: () => [...connectionKeys.all, "detail"] as const,
  detail: (id: string) => [...connectionKeys.details(), id] as const,
};

export const agentKeys = {
  all: ["agents"] as const,
  lists: () => [...agentKeys.all, "list"] as const,
  list: () => agentKeys.lists(),
  details: () => [...agentKeys.all, "detail"] as const,
  detail: (id: string) => [...agentKeys.details(), id] as const,
};

export const settingsKeys = {
  all: ["settings"] as const,
  server: () => [...settingsKeys.all, "server"] as const,
};

export const healthKeys = {
  all: ["health"] as const,
  status: () => [...healthKeys.all, "status"] as const,
};

export const reviewKeys = {
  all: ["reviews"] as const,
  list: () => [...reviewKeys.all, "list"] as const,
  stats: () => [...reviewKeys.all, "stats"] as const,
};

export const folderAccessKeys = {
  all: ["folder-access"] as const,
  lists: () => [...folderAccessKeys.all, "list"] as const,
  list: () => folderAccessKeys.lists(),
  details: () => [...folderAccessKeys.all, "detail"] as const,
  detail: (id: string) => [...folderAccessKeys.details(), id] as const,
};

export const workspaceKeys = {
  all: ["workspaces"] as const,
  lists: () => [...workspaceKeys.all, "list"] as const,
  list: () => workspaceKeys.lists(),
  details: () => [...workspaceKeys.all, "detail"] as const,
  detail: (id: string) => [...workspaceKeys.details(), id] as const,
};

export const databaseConnectionKeys = {
  all: ["database-connections"] as const,
  lists: () => [...databaseConnectionKeys.all, "list"] as const,
  list: () => databaseConnectionKeys.lists(),
  details: () => [...databaseConnectionKeys.all, "detail"] as const,
  detail: (id: string) => [...databaseConnectionKeys.details(), id] as const,
};

export const databaseInsightsKeys = {
  all: ["database-insights"] as const,
  activity: (connectionId?: string) => [...databaseInsightsKeys.all, "activity", connectionId ?? "all"] as const,
  stats: () => [...databaseInsightsKeys.all, "stats"] as const,
};

export const agentExecutionKeys = {
  all: ["agent-executions"] as const,
  lists: () => [...agentExecutionKeys.all, "list"] as const,
  list: (filters?: { agentId?: string; limit?: number }) =>
    [...agentExecutionKeys.lists(), filters] as const,
  details: () => [...agentExecutionKeys.all, "detail"] as const,
  detail: (id: string) => [...agentExecutionKeys.details(), id] as const,
  steps: (id: string, offset?: number) => [...agentExecutionKeys.all, "steps", id, offset ?? 0] as const,
  delegationTree: (id: string) => [...agentExecutionKeys.all, "delegation-tree", id] as const,
  stats: () => [...agentExecutionKeys.all, "stats"] as const,
  tasks: (id: string) => [...agentExecutionKeys.all, "tasks", id] as const,
  taskProgress: (filters?: { status?: string }) =>
    [...agentExecutionKeys.all, "task-progress", filters] as const,
};

export const githubKeys = {
  all: ["github"] as const,
  me: () => [...githubKeys.all, "me"] as const,
  dashboard: () => [...githubKeys.all, "dashboard"] as const,
  assigned: () => [...githubKeys.all, "assigned"] as const,
  reviewRequested: () => [...githubKeys.all, "review-requested"] as const,
  created: () => [...githubKeys.all, "created"] as const,
};
