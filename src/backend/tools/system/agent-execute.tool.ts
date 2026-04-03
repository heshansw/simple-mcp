import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { AgentId } from "@shared/types";
import { createAgentId } from "@shared/types.js";
import type { ExecutionEngine } from "../../agents/engine/execution-engine.js";

export const AgentExecuteInputSchema = z.object({
  agentId: z.string().min(1).describe("The agent ID to execute (e.g., 'jira-triage', 'pr-review', 'database-explorer')"),
  goal: z.string().min(1).describe("The goal for the agent to accomplish"),
  maxIterations: z.number().int().positive().max(50).optional().describe("Override max iterations (default: 25)"),
  maxToolCalls: z.number().int().positive().max(500).optional().describe("Override max tool calls (default: 100)"),
  maxTokens: z.number().int().positive().optional().describe("Override max token budget (default: 200000)"),
});

export type AgentExecuteInput = z.infer<typeof AgentExecuteInputSchema>;

export type AgentExecuteToolDeps = {
  readonly executionEngine: ExecutionEngine;
  readonly logger: Logger;
};

export function registerAgentExecuteTool(
  server: McpServer,
  deps: AgentExecuteToolDeps
): void {
  server.tool(
    "agent_execute",
    "Execute an agent with a specific goal. The agent will autonomously plan, use tools, and iterate until the goal is complete or limits are reached.",
    AgentExecuteInputSchema.shape,
    async (args) => {
      const parsed = AgentExecuteInputSchema.safeParse(args);
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

      const { agentId, goal, maxIterations, maxToolCalls, maxTokens } =
        parsed.data;

      deps.logger.info(
        { agentId, goal: goal.substring(0, 100) },
        "Agent execution requested via MCP tool"
      );

      const result = await deps.executionEngine.execute({
        agentId: createAgentId(agentId) as AgentId,
        goal,
        config: {
          ...(maxIterations !== undefined ? { maxIterations } : {}),
          ...(maxToolCalls !== undefined ? { maxToolCalls } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {}),
        },
      });

      if (isErr(result)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Agent execution failed: ${domainErrorMessage(result.error)}`,
            },
          ],
          isError: true,
        };
      }

      const run = result.value;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                runId: run.runId,
                agentId: run.agentId,
                status: "completed",
                answer: run.answer,
                stats: {
                  iterationsUsed: run.iterationsUsed,
                  toolCallsMade: run.toolCallsMade,
                  inputTokensUsed: run.inputTokensUsed,
                  outputTokensUsed: run.outputTokensUsed,
                  durationMs: run.durationMs,
                },
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
