import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";
import { randomUUID } from "node:crypto";
import type { Result, DomainError } from "@shared/result";
import {
  ok,
  err,
  isErr,
  agentExecutionError,
  notFoundError,
  integrationError,
} from "@shared/result.js";
import type { AgentId, AgentRunId } from "@shared/types";
import { createAgentRunId } from "@shared/types.js";
import type { AgentRegistry } from "../registry.js";
import type { ToolExecutor } from "./tool-executor.js";
import { createWorkingMemory } from "./working-memory.js";
import type { ObservationSummarizer } from "./observation-summarizer.js";
import { createGuardrails } from "./guardrails.js";
import type { TaskPlanner } from "./task-planner.js";
import type { DelegationHandler } from "./delegation.js";
import type {
  AgentRunConfig,
  AgentRunResult,
  AgentRunStatus,
  ToolInvocation,
  StepType,
} from "./types.js";
import { DEFAULT_RUN_CONFIG, STEP_TYPES } from "./types.js";

// ── Repository interfaces (minimal, no circular import) ────────────────

export type AgentRunsRepo = {
  readonly create: (data: {
    id: string;
    agentId: string;
    goal: string;
    status: string;
    config: string;
    startedAt: string;
    createdAt: string;
  }) => Promise<unknown>;
  readonly update: (
    id: string,
    data: Record<string, unknown>
  ) => Promise<unknown>;
  readonly findById: (id: string) => Promise<{
    id: string;
    agentId: string;
    goal: string;
    status: string;
    result: string | null;
    iterationCount: number;
    toolCallCount: number;
    inputTokensUsed: number;
    outputTokensUsed: number;
    startedAt: string;
    completedAt: string | null;
    errorMessage: string | null;
  } | undefined>;
};

// ── Connection manager interface (minimal) ─────────────────────────────

export type ConnectionManagerLike = {
  readonly hasConnection: (integration: string) => boolean;
  readonly hasTool: (toolName: string) => boolean;
};

// ── Steps repository interface (minimal) ──────────────────────────────

export type AgentRunStepsRepo = {
  readonly create: (data: {
    runId: string;
    stepIndex: number;
    stepType: string;
    toolName?: string | null;
    toolArgs?: string | null;
    toolResult?: string | null;
    toolIsError?: number | null;
    delegateTargetAgentId?: string | null;
    delegateChildRunId?: string | null;
    reasoning?: string | null;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    createdAt: string;
  }) => Promise<unknown>;
  readonly getNextStepIndex: (runId: string) => Promise<number>;
};

// ── Tasks repository interface (minimal) ──────────────────────────────

export type AgentTasksRepo = {
  readonly bulkCreate: (
    tasks: readonly {
      runId: string;
      description: string;
      dependsOn?: string;
      requiredTools?: string;
      createdAt: string;
    }[]
  ) => Promise<readonly { id: string; runId: string; description: string; status: string }[]>;
  readonly update: (
    id: string,
    data: { status?: string; result?: string | null; startedAt?: string | null; completedAt?: string | null }
  ) => Promise<unknown>;
  readonly findByRunId: (runId: string) => Promise<readonly { id: string; runId: string; description: string; dependsOn: string; requiredTools: string; status: string; result: string | null; startedAt: string | null; completedAt: string | null; createdAt: string }[]>;
};

// ── Engine dependencies ────────────────────────────────────────────────

export type ExecutionEngineDeps = {
  readonly logger: Logger;
  readonly getAnthropicApiKey: () => Promise<string | null>;
  readonly agentRegistry: AgentRegistry;
  readonly connectionManager: ConnectionManagerLike;
  readonly toolExecutor: ToolExecutor;
  readonly observationSummarizer: ObservationSummarizer;
  readonly taskPlanner: TaskPlanner;
  readonly delegationHandler: DelegationHandler | null;
  readonly agentRunsRepo: AgentRunsRepo;
  readonly agentRunStepsRepo: AgentRunStepsRepo | null;
  readonly agentTasksRepo: AgentTasksRepo | null;
};

// ── Public interface ───────────────────────────────────────────────────

export type ExecutionEngine = {
  readonly execute: (params: {
    agentId: AgentId;
    goal: string;
    config?: Partial<AgentRunConfig>;
    parentRunId?: AgentRunId;
    delegationDepth?: number;
  }) => Promise<Result<AgentRunResult, DomainError>>;
  readonly getRunStatus: (
    runId: AgentRunId
  ) => Promise<Result<AgentRunStatus, DomainError>>;
  readonly cancelRun: (runId: AgentRunId) => Promise<Result<void, DomainError>>;
};

// ── Factory ────────────────────────────────────────────────────────────

export function createExecutionEngine(
  deps: ExecutionEngineDeps
): ExecutionEngine {
  const {
    logger,
    agentRegistry,
    connectionManager,
    toolExecutor,
    observationSummarizer,
    taskPlanner,
    agentRunsRepo,
  } = deps;

  // Track active runs for cancellation
  const activeRuns = new Map<string, { cancelled: boolean }>();

  // Fire-and-forget step recording — never blocks the execution loop
  const stepCounters = new Map<string, number>();

  function emitStep(
    runId: string,
    stepType: StepType,
    data: {
      toolName?: string;
      toolArgs?: string;
      toolResult?: string;
      toolIsError?: boolean;
      delegateTargetAgentId?: string;
      delegateChildRunId?: string;
      reasoning?: string;
      inputTokens?: number;
      outputTokens?: number;
      durationMs?: number;
    }
  ): void {
    if (!deps.agentRunStepsRepo) return;
    const idx = stepCounters.get(runId) ?? 0;
    stepCounters.set(runId, idx + 1);
    deps.agentRunStepsRepo
      .create({
        runId,
        stepIndex: idx,
        stepType,
        toolName: data.toolName ?? null,
        toolArgs: data.toolArgs ?? null,
        toolResult: data.toolResult ?? null,
        toolIsError: data.toolIsError != null ? (data.toolIsError ? 1 : 0) : null,
        delegateTargetAgentId: data.delegateTargetAgentId ?? null,
        delegateChildRunId: data.delegateChildRunId ?? null,
        reasoning: data.reasoning ?? null,
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        durationMs: data.durationMs ?? 0,
        createdAt: new Date().toISOString(),
      })
      .catch((error) => {
        logger.error({ error, runId, stepType }, "Failed to record step");
      });
  }

  async function getClient(): Promise<Anthropic | null> {
    const apiKey = await deps.getAnthropicApiKey();
    if (!apiKey) return null;
    return new Anthropic({ apiKey });
  }

  return {
    async execute(params): Promise<Result<AgentRunResult, DomainError>> {
      const {
        agentId,
        goal,
        config: configOverrides,
        delegationDepth = 0,
      } = params;

      // ── 1. Validate agent ─────────────────────────────────────────
      const agentStatus = agentRegistry.checkDependencies(
        agentId,
        connectionManager
      );
      if (!agentStatus) {
        return err(notFoundError("Agent", agentId));
      }
      if (agentStatus.status === "missing_dependencies") {
        return err(
          integrationError(
            "agent-engine",
            `Agent "${agentId}" has missing dependencies: ${agentStatus.missingDependencies.join(", ")}`
          )
        );
      }

      const agent = agentStatus;
      const runConfig: AgentRunConfig = {
        ...DEFAULT_RUN_CONFIG,
        ...configOverrides,
      };

      // ── 2. Generate run ID and create DB record ───────────────────
      const runId = createAgentRunId(randomUUID());
      const startedAt = new Date().toISOString();
      const runControl = { cancelled: false };
      activeRuns.set(runId, runControl);

      try {
        await agentRunsRepo.create({
          id: runId,
          agentId,
          goal,
          status: "planning",
          config: JSON.stringify(runConfig),
          startedAt,
          createdAt: startedAt,
        });
      } catch (error) {
        logger.error({ error, runId }, "Failed to create agent run record");
        // Continue execution even if DB write fails
      }

      logger.info(
        { runId, agentId, goal: goal.substring(0, 100), delegationDepth },
        "Starting agent execution"
      );

      // ── 3. Get Anthropic client ───────────────────────────────────
      const client = await getClient();
      if (!client) {
        const execErr = agentExecutionError(
          agentId,
          runId,
          "No Anthropic API key configured",
          "planning"
        );
        await safeUpdateRun(runId, {
          status: "failed",
          errorMessage: execErr.message,
          completedAt: new Date().toISOString(),
        });
        activeRuns.delete(runId);
        return err(execErr);
      }

      // ── 4. Initialize working memory ──────────────────────────────
      const workingMemory = createWorkingMemory({
        logger,
        tokenBudget: runConfig.maxTokens,
        getClient: async () => client,
        model: runConfig.model,
      });

      workingMemory.addUserMessage(goal);

      // ── 5. Build tool definitions for Anthropic ───────────────────
      const availableTools = toolExecutor.getEntries().filter((entry) => {
        // If agent specifies requiredTools, only provide those + delegate_to_agent
        if (agent.requiredTools.length > 0) {
          return agent.requiredTools.includes(entry.name);
        }
        return true; // all tools available if no restriction
      });

      const anthropicTools: Anthropic.Tool[] = availableTools.map((entry) => ({
        name: entry.name,
        description: entry.description,
        input_schema: entry.inputSchema as Anthropic.Tool.InputSchema,
      }));

      // Add delegation meta-tool if delegation is enabled and depth allows
      if (
        deps.delegationHandler &&
        delegationDepth < runConfig.maxDelegationDepth
      ) {
        anthropicTools.push({
          name: "delegate_to_agent",
          description:
            "Delegate a sub-task to another specialized agent. Use when the current task requires expertise from a different agent.",
          input_schema: {
            type: "object" as const,
            properties: {
              targetAgentId: {
                type: "string",
                description: "The ID of the agent to delegate to",
              },
              subGoal: {
                type: "string",
                description: "The specific sub-goal for the target agent",
              },
              context: {
                type: "string",
                description:
                  "Relevant context from the current execution to pass to the target agent",
              },
            },
            required: ["targetAgentId", "subGoal"],
          },
        });
      }

      // ── 6. Initialize guardrails ──────────────────────────────────
      const guardrails = createGuardrails(
        { agentId, runId },
        {
          maxIterations: runConfig.maxIterations,
          maxToolCalls: runConfig.maxToolCalls,
          maxTokens: runConfig.maxTokens,
          timeoutMs: runConfig.timeoutMs,
        }
      );

      // ── 7. Optional planning phase ────────────────────────────────
      try {
        const planStart = Date.now();
        const planResult = await taskPlanner.plan(
          goal,
          availableTools.map((t) => t.name)
        );
        if (planResult._tag === "Ok" && planResult.value.tasks.length > 1) {
          const planSummary = planResult.value.tasks
            .map((t, i) => `${i + 1}. ${t.description}`)
            .join("\n");

          emitStep(runId, STEP_TYPES.PLAN, {
            reasoning: planSummary,
            durationMs: Date.now() - planStart,
          });

          // Persist planned tasks to database (fire-and-forget)
          if (deps.agentTasksRepo) {
            const now = new Date().toISOString();
            deps.agentTasksRepo
              .bulkCreate(
                planResult.value.tasks.map((t) => ({
                  runId,
                  description: t.description,
                  dependsOn: JSON.stringify(
                    t.dependsOn.map((depId) => {
                      const depIdx = planResult.value.tasks.findIndex((pt) => pt.id === depId);
                      return depIdx >= 0 ? depIdx : depId;
                    })
                  ),
                  requiredTools: JSON.stringify(t.requiredTools),
                  createdAt: now,
                }))
              )
              .catch((error) => {
                logger.error({ error, runId }, "Failed to persist planned tasks");
              });
          }

          workingMemory.addUserMessage(
            `Here is the execution plan:\n${planSummary}\n\nPlease execute these tasks using the available tools.`
          );
          workingMemory.addAssistantMessage([
            { type: "text", text: "I'll follow this plan and execute the tasks systematically.", citations: [] } as unknown as Anthropic.ContentBlock,
          ]);
        }
      } catch (error) {
        logger.warn({ error, runId }, "Task planning failed, proceeding without plan");
      }

      await safeUpdateRun(runId, { status: "executing" });

      // ── 8. Main execution loop ────────────────────────────────────
      let iteration = 0;
      let toolCallCount = 0;
      let inputTokensUsed = 0;
      let outputTokensUsed = 0;
      const recentToolCalls: ToolInvocation[] = [];
      const startTime = Date.now();

      while (true) {
        // Check for cancellation
        if (runControl.cancelled) {
          await safeUpdateRun(runId, {
            status: "cancelled",
            completedAt: new Date().toISOString(),
          });
          activeRuns.delete(runId);
          return err(
            agentExecutionError(agentId, runId, "Run cancelled by user", "execution")
          );
        }

        // Check guardrails
        const guardrailCheck = guardrails.checkAll({
          iteration,
          toolCalls: toolCallCount,
          tokensUsed: inputTokensUsed + outputTokensUsed,
          startTime,
          recentCalls: recentToolCalls,
        });
        if (guardrailCheck._tag === "Err") {
          logger.warn(
            { runId, error: guardrailCheck.error.message },
            "Guardrail triggered"
          );
          emitStep(runId, STEP_TYPES.GUARDRAIL, {
            reasoning: guardrailCheck.error.message,
          });
          await safeUpdateRun(runId, {
            status: "failed",
            errorMessage: guardrailCheck.error.message,
            iterationCount: iteration,
            toolCallCount,
            inputTokensUsed,
            outputTokensUsed,
            completedAt: new Date().toISOString(),
          });
          activeRuns.delete(runId);
          return err(guardrailCheck.error);
        }

        // Prune working memory if needed
        await workingMemory.pruneIfNeeded();

        // Call Anthropic
        let response: Anthropic.Message;
        try {
          const createParams: Anthropic.MessageCreateParamsNonStreaming = {
            model: runConfig.model,
            max_tokens: 4096,
            system: agent.systemPrompt,
            messages: [...workingMemory.getMessages()],
            ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
          };
          response = await client.messages.create(createParams);
        } catch (apiError) {
          const message =
            apiError instanceof Error
              ? apiError.message
              : "Unknown Anthropic API error";

          // Retry logic for transient errors
          if (iteration < 3 && isTransientError(apiError)) {
            logger.warn(
              { runId, attempt: iteration, error: message },
              "Transient API error, retrying"
            );
            const backoffMs = Math.min(1000 * 2 ** iteration, 10000);
            await sleep(backoffMs);
            iteration++;
            continue;
          }

          const execErr = agentExecutionError(
            agentId,
            runId,
            `Anthropic API error: ${message}`,
            "execution"
          );
          emitStep(runId, STEP_TYPES.ERROR, {
            reasoning: `Anthropic API error: ${message}`,
          });
          await safeUpdateRun(runId, {
            status: "failed",
            errorMessage: execErr.message,
            iterationCount: iteration,
            toolCallCount,
            inputTokensUsed,
            outputTokensUsed,
            completedAt: new Date().toISOString(),
          });
          activeRuns.delete(runId);
          return err(execErr);
        }

        // Track token usage
        inputTokensUsed += response.usage.input_tokens;
        outputTokensUsed += response.usage.output_tokens;
        iteration++;

        // Emit LLM call step
        const textContent = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n");
        emitStep(runId, STEP_TYPES.LLM_CALL, {
          ...(textContent ? { reasoning: textContent } : {}),
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          durationMs: 0,
        });

        // Add assistant response to memory
        workingMemory.addAssistantMessage(response.content);

        // ── Handle stop_reason ────────────────────────────────────
        if (response.stop_reason === "end_turn" || response.stop_reason === "max_tokens") {
          // Extract final text answer
          const textBlocks = response.content.filter(
            (b): b is Anthropic.TextBlock => b.type === "text"
          );
          const answer = textBlocks.map((b) => b.text).join("\n") || "Task completed.";
          const durationMs = Date.now() - startTime;

          const result: AgentRunResult = {
            runId,
            agentId,
            goal,
            answer,
            tasksCompleted: 0,
            toolCallsMade: toolCallCount,
            iterationsUsed: iteration,
            inputTokensUsed,
            outputTokensUsed,
            durationMs,
          };

          await safeUpdateRun(runId, {
            status: "completed",
            result: JSON.stringify(result),
            iterationCount: iteration,
            toolCallCount,
            inputTokensUsed,
            outputTokensUsed,
            completedAt: new Date().toISOString(),
          });

          logger.info(
            {
              runId,
              agentId,
              iterations: iteration,
              toolCalls: toolCallCount,
              inputTokens: inputTokensUsed,
              outputTokens: outputTokensUsed,
              durationMs,
            },
            "Agent execution completed"
          );

          activeRuns.delete(runId);
          return ok(result);
        }

        // ── Handle tool_use ───────────────────────────────────────
        if (response.stop_reason === "tool_use") {
          const toolUseBlocks = response.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );

          for (const toolUse of toolUseBlocks) {
            toolCallCount++;

            // Handle delegation meta-tool
            if (
              toolUse.name === "delegate_to_agent" &&
              deps.delegationHandler
            ) {
              const delegateArgs = toolUse.input as {
                targetAgentId: string;
                subGoal: string;
                context?: string;
              };

              const delegateStart = Date.now();
              const delegationResult = await deps.delegationHandler.delegate({
                parentRunId: runId,
                targetAgentId: delegateArgs.targetAgentId as AgentId,
                subGoal: delegateArgs.subGoal,
                context: delegateArgs.context ?? "",
                delegationDepth: delegationDepth + 1,
              });

              const delegationStepData: {
                delegateTargetAgentId: string;
                toolArgs: string;
                toolResult: string;
                toolIsError: boolean;
                durationMs: number;
                delegateChildRunId?: string;
              } = {
                delegateTargetAgentId: delegateArgs.targetAgentId,
                toolArgs: JSON.stringify({ subGoal: delegateArgs.subGoal }),
                toolResult: delegationResult._tag === "Ok"
                  ? delegationResult.value.answer.substring(0, 500)
                  : ("message" in delegationResult.error ? delegationResult.error.message : "Unknown error"),
                toolIsError: delegationResult._tag === "Err",
                durationMs: Date.now() - delegateStart,
              };
              if (delegationResult._tag === "Ok") {
                delegationStepData.delegateChildRunId = String(delegationResult.value.runId);
              }
              emitStep(runId, STEP_TYPES.DELEGATION, delegationStepData);

              if (delegationResult._tag === "Ok") {
                workingMemory.addToolResult(
                  toolUse.id,
                  `Delegation to "${delegateArgs.targetAgentId}" succeeded:\n${delegationResult.value.answer}`,
                  false
                );
              } else {
                workingMemory.addToolResult(
                  toolUse.id,
                  `Delegation to "${delegateArgs.targetAgentId}" failed: ${
                    "message" in delegationResult.error
                      ? delegationResult.error.message
                      : "Unknown error"
                  }`,
                  true
                );
              }
              continue;
            }

            // Normal tool invocation
            const toolStart = Date.now();
            const invocationResult = await toolExecutor.invoke(
              toolUse.name,
              toolUse.input as Record<string, unknown>
            );

            if (isErr(invocationResult)) {
              const errMsg = "message" in invocationResult.error ? invocationResult.error.message : "Unknown error";
              emitStep(runId, STEP_TYPES.TOOL_CALL, {
                toolName: toolUse.name,
                toolArgs: JSON.stringify(toolUse.input),
                toolResult: errMsg,
                toolIsError: true,
                durationMs: Date.now() - toolStart,
              });
              workingMemory.addToolResult(
                toolUse.id,
                `Tool error: ${errMsg}`,
                true
              );
              continue;
            }

            const invocation = invocationResult.value;

            emitStep(runId, STEP_TYPES.TOOL_CALL, {
              toolName: invocation.toolName,
              toolArgs: JSON.stringify(toolUse.input),
              toolResult: invocation.result.substring(0, 4000),
              toolIsError: invocation.isError,
              durationMs: invocation.durationMs,
            });

            recentToolCalls.push(invocation);

            // Keep only last 10 calls for cycle detection
            if (recentToolCalls.length > 10) {
              recentToolCalls.shift();
            }

            // Summarize observation if too large
            let resultText = invocation.result;
            if (observationSummarizer.shouldSummarize(resultText)) {
              resultText = await observationSummarizer.summarize(
                resultText,
                goal,
                runConfig.observationSummaryThreshold
              );
            }

            workingMemory.addToolResult(
              toolUse.id,
              resultText,
              invocation.isError
            );
          }

          // Update DB progress periodically
          if (iteration % 5 === 0) {
            await safeUpdateRun(runId, {
              iterationCount: iteration,
              toolCallCount,
              inputTokensUsed,
              outputTokensUsed,
            });
          }

          continue; // next iteration
        }

        // Unknown stop reason — treat as completion
        const fallbackAnswer = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n") || "Task completed with unknown stop reason.";

        const durationMs = Date.now() - startTime;
        const result: AgentRunResult = {
          runId,
          agentId,
          goal,
          answer: fallbackAnswer,
          tasksCompleted: 0,
          toolCallsMade: toolCallCount,
          iterationsUsed: iteration,
          inputTokensUsed,
          outputTokensUsed,
          durationMs,
        };

        await safeUpdateRun(runId, {
          status: "completed",
          result: JSON.stringify(result),
          iterationCount: iteration,
          toolCallCount,
          inputTokensUsed,
          outputTokensUsed,
          completedAt: new Date().toISOString(),
        });

        activeRuns.delete(runId);
        return ok(result);
      }
    },

    async getRunStatus(runId: AgentRunId): Promise<Result<AgentRunStatus, DomainError>> {
      const run = await agentRunsRepo.findById(runId);
      if (!run) {
        return err(notFoundError("AgentRun", runId));
      }

      return ok({
        runId: runId,
        agentId: run.agentId as AgentId,
        goal: run.goal,
        state: run.status as AgentRunStatus["state"],
        iterationCount: run.iterationCount,
        toolCallCount: run.toolCallCount,
        inputTokensUsed: run.inputTokensUsed,
        outputTokensUsed: run.outputTokensUsed,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        errorMessage: run.errorMessage,
        result: run.result,
      });
    },

    async cancelRun(runId: AgentRunId): Promise<Result<void, DomainError>> {
      const control = activeRuns.get(runId);
      if (control) {
        control.cancelled = true;
        return ok(undefined);
      }

      // If not in activeRuns, check DB
      const run = await agentRunsRepo.findById(runId);
      if (!run) {
        return err(notFoundError("AgentRun", runId));
      }

      if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
        return ok(undefined); // already terminal
      }

      await safeUpdateRun(runId, {
        status: "cancelled",
        completedAt: new Date().toISOString(),
      });

      return ok(undefined);
    },
  };

  async function safeUpdateRun(
    runId: string,
    data: Record<string, unknown>
  ): Promise<void> {
    try {
      await agentRunsRepo.update(runId, data);
    } catch (error) {
      logger.error({ error, runId }, "Failed to update agent run record");
    }
  }
}

function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("rate limit") ||
      msg.includes("timeout") ||
      msg.includes("overloaded") ||
      msg.includes("529") ||
      msg.includes("503")
    );
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
