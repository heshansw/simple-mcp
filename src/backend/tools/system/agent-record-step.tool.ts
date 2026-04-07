import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { AgentRunStepsRepository } from "../../db/repositories/agent-run-steps.repository.js";

export const AgentRecordStepInputSchema = z.object({
  runId: z.string().min(1).describe("The run ID returned by agent_start_run"),
  stepType: z
    .enum(["llm_call", "tool_call", "delegation", "plan", "error", "guardrail"])
    .describe("Type of step being recorded"),
  toolName: z
    .string()
    .optional()
    .describe("Tool name (for tool_call steps)"),
  toolArgs: z
    .string()
    .optional()
    .describe("JSON-serialized tool arguments (for tool_call steps)"),
  toolResult: z
    .string()
    .optional()
    .describe("Tool result summary — keep brief, will be truncated (for tool_call steps)"),
  toolIsError: z
    .boolean()
    .optional()
    .describe("Whether the tool call returned an error"),
  reasoning: z
    .string()
    .optional()
    .describe("Your reasoning or observation for this step"),
  durationMs: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Duration of this step in milliseconds"),
});

export type AgentRecordStepInput = z.infer<typeof AgentRecordStepInputSchema>;

export type AgentRecordStepToolDeps = {
  readonly agentRunStepsRepo: AgentRunStepsRepository;
  readonly logger: Logger;
};

export function registerAgentRecordStepTool(
  server: McpServer,
  deps: AgentRecordStepToolDeps
): void {
  server.tool(
    "agent_record_step",
    "Record a step in an agent run for tracking and observability. Call this after each significant action (tool call, reasoning step, error). Steps appear in the admin panel's execution detail view.",
    AgentRecordStepInputSchema.shape,
    async (args) => {
      const parsed = AgentRecordStepInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: `Validation error: ${parsed.error.message}` }],
          isError: true,
        };
      }

      const { runId, stepType, toolName, toolArgs, toolResult, toolIsError, reasoning, durationMs } =
        parsed.data;

      const nextIndex = await deps.agentRunStepsRepo.getNextStepIndex(runId);

      const step = await deps.agentRunStepsRepo.create({
        runId,
        stepIndex: nextIndex,
        stepType,
        toolName: toolName ?? null,
        toolArgs: toolArgs ?? null,
        toolResult: toolResult ?? null,
        toolIsError: toolIsError != null ? (toolIsError ? 1 : 0) : null,
        reasoning: reasoning ?? null,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: durationMs ?? 0,
        createdAt: new Date().toISOString(),
      });

      deps.logger.debug(
        { runId, stepIndex: nextIndex, stepType },
        "Step recorded via MCP tool"
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              stepId: step.id,
              stepIndex: step.stepIndex,
              stepType: step.stepType,
              recorded: true,
            }),
          },
        ],
      };
    }
  );
}
