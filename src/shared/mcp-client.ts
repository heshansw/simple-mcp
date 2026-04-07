export const APP_DISPLAY_NAME = "Simple MCP";

export const DEFAULT_LOCAL_MCP_CLIENT_CONNECTION_NAME = "MCP Client (Local)";

export const DEDICATED_LOCAL_MCP_CLIENT_CONNECTION_NAMES = [
  "Claude (Local)",
  "Codex (Local)",
] as const;

export const LOCAL_MCP_CLIENT_CONNECTION_NAMES = [
  DEFAULT_LOCAL_MCP_CLIENT_CONNECTION_NAME,
  ...DEDICATED_LOCAL_MCP_CLIENT_CONNECTION_NAMES,
] as const;

export function isLocalMcpClientConnectionName(name: string): boolean {
  return LOCAL_MCP_CLIENT_CONNECTION_NAMES.includes(
    name as (typeof LOCAL_MCP_CLIENT_CONNECTION_NAMES)[number]
  );
}

export function shouldCreateDefaultLocalMcpClientConnection(
  connections: ReadonlyArray<{ readonly name: string }>
): boolean {
  return !connections.some((connection) =>
    isLocalMcpClientConnectionName(connection.name)
  );
}

export function getMissingDedicatedLocalMcpClientConnectionNames(
  connections: ReadonlyArray<{ readonly name: string }>
): Array<(typeof DEDICATED_LOCAL_MCP_CLIENT_CONNECTION_NAMES)[number]> {
  return DEDICATED_LOCAL_MCP_CLIENT_CONNECTION_NAMES.filter(
    (name) => !connections.some((connection) => connection.name === name)
  );
}

export function isAnthropicConnectionCandidate(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("anthropic") || normalized.includes("claude");
}

export function getConnectionTypeLabel(params: {
  readonly name: string;
  readonly integrationType: string;
}): string {
  return isLocalMcpClientConnectionName(params.name)
    ? "LOCAL MCP CLIENT"
    : params.integrationType.toUpperCase();
}

export const REVIEWS_PAGE_DESCRIPTION =
  "All PR reviews submitted through MCP review tools.";

export const REVIEWS_EMPTY_STATE_PREFIX =
  "Ask your MCP client to review a PR — it will call ";

export const DATABASE_PERMISSIONS_DESCRIPTION =
  "Only listed schemas/tables are accessible to MCP agents. Leave tables empty to allow all tables in a schema.";

export const DATABASE_CONNECTIONS_DESCRIPTION =
  "Register MySQL and PostgreSQL connections for MCP agents to explore schemas, describe tables, and run queries.";

export const LOCAL_MCP_CLIENT_CONNECTION_DESCRIPTION =
  "This entry represents a local MCP client such as Claude or Codex. It does not require external integration credentials.";
