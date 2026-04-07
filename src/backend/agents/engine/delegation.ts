import type { Logger } from "pino";
import type { Result, DomainError } from "@shared/result";
import { err, agentExecutionError } from "@shared/result.js";
import type { AgentId, AgentRunId } from "@shared/types";
import { createAgentId } from "@shared/types.js";
import type { AgentRunResult, AgentRunConfig } from "./types.js";

/**
 * Minimal interface for the execution engine to avoid circular dependency.
 * The delegation handler calls back into the engine to run child agents.
 */
export type EngineExecuteFn = (params: {
  agentId: AgentId;
  goal: string;
  config?: Partial<AgentRunConfig>;
  parentRunId?: AgentRunId;
  delegationDepth?: number;
}) => Promise<Result<AgentRunResult, DomainError>>;

export type DelegationHandlerDeps = {
  readonly logger: Logger;
  readonly maxDelegationDepth: number;
};

export type DelegationHandler = {
  readonly delegate: (params: {
    parentRunId: AgentRunId;
    targetAgentId: AgentId;
    subGoal: string;
    context: string;
    delegationDepth: number;
  }) => Promise<Result<AgentRunResult, DomainError>>;
  readonly setExecuteFn: (fn: EngineExecuteFn) => void;
};

export function createDelegationHandler(
  deps: DelegationHandlerDeps
): DelegationHandler {
  const { logger, maxDelegationDepth } = deps;
  let executeFn: EngineExecuteFn | null = null;

  return {
    setExecuteFn(fn: EngineExecuteFn): void {
      executeFn = fn;
    },

    async delegate(params): Promise<Result<AgentRunResult, DomainError>> {
      const {
        parentRunId,
        targetAgentId,
        subGoal,
        context,
        delegationDepth,
      } = params;

      // Check delegation depth
      if (delegationDepth >= maxDelegationDepth) {
        return err(
          agentExecutionError(
            targetAgentId,
            parentRunId,
            `Delegation depth limit reached (${delegationDepth}/${maxDelegationDepth}). Cannot delegate further.`,
            "delegation"
          )
        );
      }

      if (!executeFn) {
        return err(
          agentExecutionError(
            targetAgentId,
            parentRunId,
            "Delegation handler not initialized: no execute function set",
            "delegation"
          )
        );
      }

      logger.info(
        {
          parentRunId,
          targetAgentId,
          subGoal: subGoal.substring(0, 100),
          delegationDepth,
        },
        "Delegating to child agent"
      );

      // Build the child goal with summarized parent context
      const contextSuffix = context
        ? `\n\nContext from parent agent:\n${context.substring(0, 2000)}`
        : "";
      const childGoal = `${subGoal}${contextSuffix}`;

      // Execute child agent
      const result = await executeFn({
        agentId: createAgentId(targetAgentId),
        goal: childGoal,
        parentRunId,
        delegationDepth,
      });

      if (result._tag === "Ok") {
        logger.info(
          {
            parentRunId,
            targetAgentId,
            childRunId: result.value.runId,
            toolCalls: result.value.toolCallsMade,
          },
          "Child agent delegation completed successfully"
        );
      } else {
        logger.warn(
          {
            parentRunId,
            targetAgentId,
            error: "message" in result.error ? result.error.message : "Unknown",
          },
          "Child agent delegation failed"
        );
      }

      return result;
    },
  };
}
