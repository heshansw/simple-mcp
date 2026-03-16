// Brand utility type for creating distinct string types
export type Brand<T, B extends string> = T & { readonly __brand: B };

// Branded domain types
export type UserId = Brand<string, "UserId">;
export type ConnectionId = Brand<string, "ConnectionId">;
export type AgentId = Brand<string, "AgentId">;
export type ToolName = Brand<string, "ToolName">;
export type IntegrationName = Brand<string, "IntegrationName">;

// Helper functions to create branded values (cast for runtime)
export function createUserId(value: string): UserId {
  return value as UserId;
}

export function createConnectionId(value: string): ConnectionId {
  return value as ConnectionId;
}

export function createAgentId(value: string): AgentId {
  return value as AgentId;
}

export function createToolName(value: string): ToolName {
  return value as ToolName;
}

export function createIntegrationName(value: string): IntegrationName {
  return value as IntegrationName;
}

// Integration type literal
export type IntegrationType = "jira" | "github";

// Utility types
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type DeepPartial<T> = T extends object
  ? {
      [P in keyof T]?: DeepPartial<T[P]>;
    }
  : T;
