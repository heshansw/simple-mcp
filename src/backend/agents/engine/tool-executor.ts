import type { Logger } from "pino";
import type { Result } from "@shared/result";
import { ok, err, integrationError } from "@shared/result.js";
import type { ToolHandlerRegistry } from "./tool-handler-registry.js";
import type { ToolInvocation, ToolSchemaEntry } from "./types.js";

export type ToolExecutorDeps = {
  readonly registry: ToolHandlerRegistry;
  readonly logger: Logger;
};

export type ToolExecutor = {
  readonly invoke: (
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<Result<ToolInvocation, import("@shared/result").DomainError>>;
  readonly listAvailable: () => readonly string[];
  readonly getEntries: () => readonly ToolSchemaEntry[];
  readonly getEntry: (toolName: string) => ToolSchemaEntry | undefined;
};

export function createToolExecutor(deps: ToolExecutorDeps): ToolExecutor {
  const { registry, logger } = deps;

  return {
    async invoke(
      toolName: string,
      args: Record<string, unknown>
    ): Promise<Result<ToolInvocation, import("@shared/result").DomainError>> {
      const entry = registry.get(toolName);
      if (!entry) {
        return err(
          integrationError(
            "agent-engine",
            `Tool "${toolName}" not found in handler registry`
          )
        );
      }

      const startTime = Date.now();
      try {
        logger.debug({ toolName, args }, "Invoking tool via engine");

        const handlerResult = await entry.handler(args);
        const durationMs = Date.now() - startTime;

        const resultText = handlerResult.content
          .map((block) => block.text)
          .join("\n");

        const invocation: ToolInvocation = {
          toolName,
          args,
          result: resultText,
          durationMs,
          isError: handlerResult.isError ?? false,
        };

        logger.info(
          { toolName, durationMs, isError: invocation.isError },
          "Tool invocation complete"
        );

        return ok(invocation);
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const message =
          error instanceof Error ? error.message : "Unknown tool execution error";

        logger.error(
          { toolName, durationMs, error: message },
          "Tool invocation failed with exception"
        );

        return ok({
          toolName,
          args,
          result: `Error: ${message}`,
          durationMs,
          isError: true,
        });
      }
    },

    listAvailable(): readonly string[] {
      return registry.list();
    },

    getEntries(): readonly ToolSchemaEntry[] {
      return registry.listEntries();
    },

    getEntry(toolName: string): ToolSchemaEntry | undefined {
      return registry.get(toolName);
    },
  };
}
