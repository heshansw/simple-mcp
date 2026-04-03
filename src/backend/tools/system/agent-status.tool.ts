import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { AgentRunId } from "@shared/types";
import { createAgentRunId } from "@shared/types.js";
import type { ExecutionEngine } from "../../agents/engine/execution-engine.js";

export const AgentStatusInputSchema = z.object({
  runId: z.string().min(1).describe("The agent run ID to check status for"),
});

export type AgentStatusInput = z.infer<typeof AgentStatusInputSchema>;

export type AgentStatusToolDeps = {
  readonly executionEngine: ExecutionEngine;
  readonly logger: Logger;
};

export function registerAgentStatusTool(
  server: McpServer,
  deps: AgentStatusToolDeps
): void {
  server.tool(
    "agent_status",
    "Check the status of an agent execution run. Returns iteration count, tool calls, token usage, and result if completed.",
    AgentStatusInputSchema.shape,
    async (args) => {
      const parsed = AgentStatusInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Validation error: ${parsed.error.message}`,
            },
          ],
          isError: true,
        };
      }

      const result = await deps.executionEngine.getRunStatus(
        createAgentRunId(parsed.data.runId) as AgentRunId
      );

      if (isErr(result)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${domainErrorMessage(result.error)}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.value, null, 2),
          },
        ],
      };
    }
  );
}
