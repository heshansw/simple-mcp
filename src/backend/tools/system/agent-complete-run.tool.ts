import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { AgentRunsRepository } from "../../db/repositories/agent-runs.repository.js";
import type { AgentRunStepsRepository } from "../../db/repositories/agent-run-steps.repository.js";

export const AgentCompleteRunInputSchema = z.object({
  runId: z.string().min(1).describe("The run ID returned by agent_start_run"),
  status: z
    .enum(["completed", "failed", "cancelled"])
    .describe("Final status of the run"),
  result: z
    .string()
    .optional()
    .describe("Summary of what was accomplished (for completed runs)"),
  errorMessage: z
    .string()
    .optional()
    .describe("Error description (for failed runs)"),
});

export type AgentCompleteRunInput = z.infer<typeof AgentCompleteRunInputSchema>;

export type AgentCompleteRunToolDeps = {
  readonly agentRunsRepo: AgentRunsRepository;
  readonly agentRunStepsRepo: AgentRunStepsRepository;
  readonly logger: Logger;
};

export function registerAgentCompleteRunTool(
  server: McpServer,
  deps: AgentCompleteRunToolDeps
): void {
  server.tool(
    "agent_complete_run",
    "Mark an agent run as completed, failed, or cancelled. Call this when the goal has been accomplished, an unrecoverable error occurs, or the run should be stopped. This finalizes the run and updates the admin panel.",
    AgentCompleteRunInputSchema.shape,
    async (args) => {
      const parsed = AgentCompleteRunInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: `Validation error: ${parsed.error.message}` }],
          isError: true,
        };
      }

      const { runId, status, result, errorMessage } = parsed.data;
      const now = new Date().toISOString();

      // Get step counts for the summary
      const stepCount = await deps.agentRunStepsRepo.countByRunId(runId);

      const updateData: Record<string, unknown> = {
        status,
        completedAt: now,
      };

      if (result !== undefined) {
        updateData.result = JSON.stringify({
          answer: result,
          mode: "client-driven",
        });
      }

      if (errorMessage !== undefined) {
        updateData.errorMessage = errorMessage;
      }

      const updated = await deps.agentRunsRepo.update(runId, updateData);

      if (!updated) {
        return {
          content: [{ type: "text" as const, text: `Run "${runId}" not found.` }],
          isError: true,
        };
      }

      const startTime = new Date(updated.startedAt).getTime();
      const durationMs = Date.now() - startTime;

      deps.logger.info(
        { runId, status, durationMs, stepCount },
        "Client-driven agent run completed"
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                runId: updated.id,
                agentId: updated.agentId,
                status: updated.status,
                durationMs,
                stepCount,
                iterationCount: updated.iterationCount,
                toolCallCount: updated.toolCallCount,
                completed: true,
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
