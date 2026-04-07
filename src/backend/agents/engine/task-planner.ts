import type Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";
import { randomUUID } from "node:crypto";
import type { Result, DomainError } from "@shared/result";
import { ok, err, agentExecutionError } from "@shared/result.js";
import type { AgentTaskId } from "@shared/types";
import { createAgentTaskId } from "@shared/types.js";
import type { TaskPlan, PlannedTask } from "./types.js";

export type TaskPlannerDeps = {
  readonly logger: Logger;
  readonly getClient: () => Promise<Anthropic | null>;
  readonly model: string;
};

export type TaskPlanner = {
  readonly plan: (
    goal: string,
    availableTools: readonly string[]
  ) => Promise<Result<TaskPlan, DomainError>>;
  readonly replan: (
    goal: string,
    completedTasks: readonly PlannedTask[],
    failedTask: PlannedTask,
    availableTools: readonly string[]
  ) => Promise<Result<TaskPlan, DomainError>>;
};

const PLAN_SYSTEM_PROMPT = `You are a task planning assistant. Given a goal and a list of available tools, decompose the goal into a sequence of concrete tasks.

Rules:
- Each task should be specific and actionable
- Tasks should reference which tools they need
- Dependencies between tasks must be explicit
- Keep the number of tasks minimal (1-7 tasks)
- For simple goals, a single task is fine

Respond with ONLY valid JSON in this format:
{
  "tasks": [
    {
      "description": "What this task does",
      "dependsOn": [],
      "requiredTools": ["tool_name_1"]
    }
  ]
}

The "dependsOn" field contains zero-based indices of tasks this task depends on (e.g., [0] means it depends on the first task).`;

export function createTaskPlanner(deps: TaskPlannerDeps): TaskPlanner {
  const { logger } = deps;

  async function parsePlanResponse(
    responseText: string
  ): Promise<PlannedTask[]> {
    let jsonStr = responseText.trim();

    // Strip markdown code fences if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as {
      tasks: Array<{
        description: string;
        dependsOn?: number[];
        requiredTools?: string[];
      }>;
    };

    if (!Array.isArray(parsed.tasks)) {
      throw new Error("Invalid plan format: missing tasks array");
    }

    // Generate IDs and convert dependency indices to IDs
    const taskIds: AgentTaskId[] = parsed.tasks.map(() =>
      createAgentTaskId(randomUUID())
    );

    return parsed.tasks.map((task, index) => ({
      id: taskIds[index]!,
      description: task.description,
      dependsOn: (task.dependsOn ?? [])
        .filter((dep) => dep >= 0 && dep < index)
        .map((dep) => taskIds[dep]!),
      requiredTools: task.requiredTools ?? [],
      status: "pending" as const,
    }));
  }

  return {
    async plan(
      goal: string,
      availableTools: readonly string[]
    ): Promise<Result<TaskPlan, DomainError>> {
      const client = await deps.getClient();
      if (!client) {
        // No client — return a single-task plan as fallback
        return ok({
          tasks: [
            {
              id: createAgentTaskId(randomUUID()),
              description: goal,
              dependsOn: [],
              requiredTools: [...availableTools],
              status: "pending" as const,
            },
          ],
        });
      }

      try {
        const response = await client.messages.create({
          model: deps.model,
          max_tokens: 2000,
          system: PLAN_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Goal: ${goal}\n\nAvailable tools: ${availableTools.join(", ")}`,
            },
          ],
        });

        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          throw new Error("No text response from planner");
        }

        const tasks = await parsePlanResponse(textBlock.text);
        logger.info(
          { goal: goal.substring(0, 80), taskCount: tasks.length },
          "Task plan generated"
        );

        return ok({ tasks });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown planning error";
        logger.warn({ error: message, goal: goal.substring(0, 80) }, "Task planning failed");

        // Fallback to single-task plan
        return ok({
          tasks: [
            {
              id: createAgentTaskId(randomUUID()),
              description: goal,
              dependsOn: [],
              requiredTools: [...availableTools],
              status: "pending" as const,
            },
          ],
        });
      }
    },

    async replan(
      goal: string,
      completedTasks: readonly PlannedTask[],
      failedTask: PlannedTask,
      availableTools: readonly string[]
    ): Promise<Result<TaskPlan, DomainError>> {
      const client = await deps.getClient();
      if (!client) {
        return err(
          agentExecutionError("", "", "No Anthropic API key for replanning", "planning")
        );
      }

      try {
        const completedSummary = completedTasks
          .map((t) => `- [DONE] ${t.description}`)
          .join("\n");
        const failedSummary = `- [FAILED] ${failedTask.description}`;

        const response = await client.messages.create({
          model: deps.model,
          max_tokens: 2000,
          system: PLAN_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: `Goal: ${goal}

Available tools: ${availableTools.join(", ")}

Progress so far:
${completedSummary}
${failedSummary}

The task "${failedTask.description}" failed. Please create a revised plan for the REMAINING work only. Do not re-do completed tasks.`,
            },
          ],
        });

        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          throw new Error("No text response from replanner");
        }

        const tasks = await parsePlanResponse(textBlock.text);
        logger.info(
          { goal: goal.substring(0, 80), taskCount: tasks.length },
          "Task re-plan generated"
        );

        return ok({ tasks });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown replanning error";
        return err(
          agentExecutionError("", "", `Replanning failed: ${message}`, "planning")
        );
      }
    },
  };
}
