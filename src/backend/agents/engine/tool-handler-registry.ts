import type { Logger } from "pino";
import type { ToolHandler, ToolSchemaEntry } from "./types.js";

export type ToolHandlerRegistryDeps = {
  readonly logger: Logger;
};

export type ToolHandlerRegistry = {
  readonly register: (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: ToolHandler
  ) => void;
  readonly get: (name: string) => ToolSchemaEntry | undefined;
  readonly list: () => readonly string[];
  readonly listEntries: () => readonly ToolSchemaEntry[];
  readonly has: (name: string) => boolean;
};

export function createToolHandlerRegistry(
  deps: ToolHandlerRegistryDeps
): ToolHandlerRegistry {
  const entries = new Map<string, ToolSchemaEntry>();

  return {
    register(
      name: string,
      description: string,
      inputSchema: Record<string, unknown>,
      handler: ToolHandler
    ): void {
      entries.set(name, { name, description, inputSchema, handler });
      deps.logger.debug({ toolName: name }, "Tool handler registered in engine registry");
    },

    get(name: string): ToolSchemaEntry | undefined {
      return entries.get(name);
    },

    list(): readonly string[] {
      return Array.from(entries.keys());
    },

    listEntries(): readonly ToolSchemaEntry[] {
      return Array.from(entries.values());
    },

    has(name: string): boolean {
      return entries.has(name);
    },
  };
}
