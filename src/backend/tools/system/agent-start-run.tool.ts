import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import { randomUUID } from "node:crypto";
import type { AgentId } from "@shared/types";
import type { AgentRegistry } from "../../agents/registry.js";
import type { AgentRunsRepository } from "../../db/repositories/agent-runs.repository.js";
import type { AgentTasksRepository } from "../../db/repositories/agent-tasks.repository.js";

export const AgentStartRunInputSchema = z.object({
  agentId: z
    .string()
    .min(1)
    .describe("The agent ID to execute (use agent_list to see available agents)"),
  goal: z
    .string()
    .min(1)
    .describe("The goal for the agent to accomplish"),
  tasks: z
    .array(
      z.object({
        description: z.string().min(1).describe("Task description"),
        requiredTools: z
          .array(z.string())
          .optional()
          .describe("Tool names needed for this task"),
        dependsOn: z
          .array(z.number().int().min(0))
          .optional()
          .describe("Zero-based indices of tasks this depends on"),
      })
    )
    .optional()
    .describe("Optional planned tasks to track. If omitted, run is tracked without task breakdown."),
  maxIterations: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe("Max iterations for guardrail tracking (default: 25)"),
});

export type AgentStartRunInput = z.infer<typeof AgentStartRunInputSchema>;

export type AgentStartRunToolDeps = {
  readonly agentRegistry: AgentRegistry;
  readonly agentRunsRepo: AgentRunsRepository;
  readonly agentTasksRepo: AgentTasksRepository;
  readonly logger: Logger;
};

export function registerAgentStartRunTool(
  server: McpServer,
  deps: AgentStartRunToolDeps
): void {
  server.tool(
    "agent_start_run",
    "Start a tracked agent run driven by Claude Code. Returns the agent's system prompt, allowed tools, and a runId for tracking. Use this instead of agent_execute when you want Claude Code to drive the execution loop directly (no Anthropic API key needed). After starting, call the agent's tools, record steps with agent_record_step, and finish with agent_complete_run.",
    AgentStartRunInputSchema.shape,
    async (args) => {
      const parsed = AgentStartRunInputSchema.safeParse(args);
      if (!parsed.success) {
        return {
          content: [{ type: "text" as const, text: `Validation error: ${parsed.error.message}` }],
          isError: true,
        };
      }

      const { agentId, goal, tasks, maxIterations } = parsed.data;
      const agent = deps.agentRegistry.getById(agentId as AgentId);

      if (!agent) {
        return {
          content: [{ type: "text" as const, text: `Agent "${agentId}" not found. Use agent_list to see available agents.` }],
          isError: true,
        };
      }

      const runId = randomUUID();
      const now = new Date().toISOString();
      const config = JSON.stringify({
        maxIterations: maxIterations ?? 25,
        mode: "claude-code-driven",
      });

      // Create the run record
      const run = await deps.agentRunsRepo.create({
        id: runId,
        agentId,
        goal,
        status: "executing",
        config,
        startedAt: now,
        createdAt: now,
      });

      // Persist planned tasks if provided
      let taskRecords: readonly { id: string; description: string; status: string }[] = [];
      if (tasks && tasks.length > 0) {
        taskRecords = await deps.agentTasksRepo.bulkCreate(
          tasks.map((t) => ({
            runId,
            description: t.description,
            dependsOn: JSON.stringify(t.dependsOn ?? []),
            requiredTools: JSON.stringify(t.requiredTools ?? []),
            createdAt: now,
          }))
        );
      }

      deps.logger.info(
        { agentId, runId, goal: goal.substring(0, 100), taskCount: taskRecords.length },
        "Claude Code-driven agent run started"
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                runId: run.id,
                agentId: agent.id,
                agentName: agent.name,
                systemPrompt: agent.systemPrompt,
                requiredTools: agent.requiredTools,
                requiredIntegrations: agent.requiredIntegrations,
                tasks: taskRecords.map((t, i) => ({
                  taskId: t.id,
                  index: i,
                  description: t.description,
                  status: t.status,
                })),
                instructions: "You are now acting as this agent. Follow the system prompt above. Use the available MCP tools to accomplish the goal. Call agent_record_step after significant actions. Call agent_update_task to update task status. Call agent_complete_run when done.",
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
