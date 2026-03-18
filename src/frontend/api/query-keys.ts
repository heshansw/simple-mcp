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

export const githubKeys = {
  all: ["github"] as const,
  me: () => [...githubKeys.all, "me"] as const,
  dashboard: () => [...githubKeys.all, "dashboard"] as const,
  assigned: () => [...githubKeys.all, "assigned"] as const,
  reviewRequested: () => [...githubKeys.all, "review-requested"] as const,
  created: () => [...githubKeys.all, "created"] as const,
};
