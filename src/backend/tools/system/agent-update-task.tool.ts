import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { AgentTasksRepository } from "../../db/repositories/agent-tasks.repository.js";

export const AgentUpdateTaskInputSchema = z.object({
  taskId: z.string().min(1).describe("The task ID returned by agent_start_run"),
  status: z
    .enum(["pending", "in_progress", "completed", "failed", "skipped"])
    .describe("New status for the task"),
  result: z
    .string()
    .optional()
    .describe("Brief result or error message for this task"),
});

export type AgentUpdateTaskInput = z.infer<typeof AgentUpdateTaskInputSchema>;

export type AgentUpdateTaskToolDeps = {
  readonly agentTasksRepo: AgentTasksRepository;
  readonly logger: Logger;
};

export function registerAgentUpdateTaskTool(
  server: McpServer,
  deps: AgentUpdateTaskToolDeps
): void {
  server.tool(
    "agent_update_task",
    "Update the status of a planned task within an agent run. Call this as you start, complete, or fail each task. Task progress is shown on the admin panel's Task Progress page.",
    AgentUpdateTaskInputSchema.shape,
    async (args) => {
      const parsed = AgentUpdateTaskInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: `Validation error: ${parsed.error.message}` }],
          isError: true,
        };
      }

      const { taskId, status, result } = parsed.data;
      const now = new Date().toISOString();

      const updateData: {
        status: string;
        result?: string | null;
        startedAt?: string | null;
        completedAt?: string | null;
      } = { status };

      if (result !== undefined) {
        updateData.result = result;
      }

      if (status === "in_progress") {
        updateData.startedAt = now;
      }

      if (status === "completed" || status === "failed" || status === "skipped") {
        updateData.completedAt = now;
      }

      const updated = await deps.agentTasksRepo.update(taskId, updateData);

      if (!updated) {
        return {
          content: [{ type: "text" as const, text: `Task "${taskId}" not found.` }],
          isError: true,
        };
      }

      deps.logger.debug({ taskId, status }, "Task updated via MCP tool");

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              taskId: updated.id,
              description: updated.description,
              status: updated.status,
              updated: true,
            }),
          },
        ],
      };
    }
  );
}
