import type { Result } from "@shared/result";
import type { AgentExecutionError } from "@shared/result";
import { ok, err, agentExecutionError } from "@shared/result.js";
import type { GuardrailLimits, ToolInvocation } from "./types.js";
import { DEFAULT_GUARDRAIL_LIMITS } from "./types.js";

export type GuardrailContext = {
  readonly agentId: string;
  readonly runId: string;
};

export type Guardrails = {
  readonly checkIterationLimit: (
    current: number
  ) => Result<void, AgentExecutionError>;
  readonly checkToolCallLimit: (
    current: number
  ) => Result<void, AgentExecutionError>;
  readonly checkTokenBudget: (
    used: number
  ) => Result<void, AgentExecutionError>;
  readonly checkTimeout: (
    startTime: number
  ) => Result<void, AgentExecutionError>;
  readonly checkCycleDetection: (
    recentCalls: readonly ToolInvocation[]
  ) => Result<void, AgentExecutionError>;
  readonly checkAll: (params: {
    iteration: number;
    toolCalls: number;
    tokensUsed: number;
    startTime: number;
    recentCalls: readonly ToolInvocation[];
  }) => Result<void, AgentExecutionError>;
};

export function createGuardrails(
  context: GuardrailContext,
  limits?: Partial<GuardrailLimits>
): Guardrails {
  const config: GuardrailLimits = {
    ...DEFAULT_GUARDRAIL_LIMITS,
    ...limits,
  };

  const makeError = (message: string, phase: AgentExecutionError["phase"]) =>
    agentExecutionError(context.agentId, context.runId, message, phase);

  return {
    checkIterationLimit(current: number): Result<void, AgentExecutionError> {
      if (current >= config.maxIterations) {
        return err(
          makeError(
            `Iteration limit reached: ${current}/${config.maxIterations}`,
            "execution"
          )
        );
      }
      return ok(undefined);
    },

    checkToolCallLimit(current: number): Result<void, AgentExecutionError> {
      if (current >= config.maxToolCalls) {
        return err(
          makeError(
            `Tool call limit reached: ${current}/${config.maxToolCalls}`,
            "execution"
          )
        );
      }
      return ok(undefined);
    },

    checkTokenBudget(used: number): Result<void, AgentExecutionError> {
      if (used >= config.maxTokens) {
        return err(
          makeError(
            `Token budget exhausted: ${used}/${config.maxTokens}`,
            "execution"
          )
        );
      }
      return ok(undefined);
    },

    checkTimeout(startTime: number): Result<void, AgentExecutionError> {
      const elapsed = Date.now() - startTime;
      if (elapsed >= config.timeoutMs) {
        return err(
          makeError(
            `Execution timeout: ${elapsed}ms exceeds ${config.timeoutMs}ms limit`,
            "execution"
          )
        );
      }
      return ok(undefined);
    },

    checkCycleDetection(
      recentCalls: readonly ToolInvocation[]
    ): Result<void, AgentExecutionError> {
      const maxDuplicates = config.maxConsecutiveDuplicateCalls;
      if (recentCalls.length < maxDuplicates) {
        return ok(undefined);
      }

      const tail = recentCalls.slice(-maxDuplicates);
      const firstCall = tail[0];
      if (!firstCall) {
        return ok(undefined);
      }

      const firstKey = `${firstCall.toolName}:${JSON.stringify(firstCall.args)}`;
      const allSame = tail.every(
        (call) => `${call.toolName}:${JSON.stringify(call.args)}` === firstKey
      );

      if (allSame) {
        return err(
          makeError(
            `Cycle detected: tool "${firstCall.toolName}" called ${maxDuplicates} times with identical arguments`,
            "execution"
          )
        );
      }

      return ok(undefined);
    },

    checkAll(params): Result<void, AgentExecutionError> {
      const checks = [
        this.checkIterationLimit(params.iteration),
        this.checkToolCallLimit(params.toolCalls),
        this.checkTokenBudget(params.tokensUsed),
        this.checkTimeout(params.startTime),
        this.checkCycleDetection(params.recentCalls),
      ];

      for (const check of checks) {
        if (check._tag === "Err") {
          return check;
        }
      }

      return ok(undefined);
    },
  };
}
