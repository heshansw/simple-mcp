import type Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";

export type WorkingMemoryDeps = {
  readonly logger: Logger;
  readonly tokenBudget: number;
  readonly getClient: () => Promise<Anthropic | null>;
  readonly model: string;
};

export type WorkingMemory = {
  readonly addUserMessage: (content: string) => void;
  readonly addAssistantMessage: (content: Anthropic.ContentBlock[]) => void;
  readonly addToolResult: (toolUseId: string, result: string, isError: boolean) => void;
  readonly getMessages: () => readonly Anthropic.MessageParam[];
  readonly getTokenEstimate: () => number;
  readonly getTokenBudget: () => number;
  readonly pruneIfNeeded: () => Promise<void>;
  readonly clear: () => void;
};

/**
 * Estimate token count from a string using a simple heuristic.
 * ~4 characters per token is a reasonable approximation for English text + code.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateMessageTokens(msg: Anthropic.MessageParam): number {
  if (typeof msg.content === "string") {
    return estimateTokens(msg.content);
  }
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((sum, block) => {
      if ("text" in block && typeof block.text === "string") {
        return sum + estimateTokens(block.text);
      }
      if ("content" in block && typeof block.content === "string") {
        return sum + estimateTokens(block.content);
      }
      // tool_use blocks: estimate from JSON serialization of input
      if (block.type === "tool_use" && "input" in block) {
        return sum + estimateTokens(JSON.stringify(block.input));
      }
      // tool_result blocks
      if (block.type === "tool_result" && "content" in block) {
        const content = block.content;
        if (typeof content === "string") {
          return sum + estimateTokens(content);
        }
        if (Array.isArray(content)) {
          return sum + content.reduce((s, c) => {
            if ("text" in c && typeof c.text === "string") {
              return s + estimateTokens(c.text);
            }
            return s;
          }, 0);
        }
      }
      return sum + 50; // fallback estimate for unknown block types
    }, 0);
  }
  return 50;
}

export function createWorkingMemory(deps: WorkingMemoryDeps): WorkingMemory {
  const { logger, tokenBudget } = deps;
  const messages: Anthropic.MessageParam[] = [];

  return {
    addUserMessage(content: string): void {
      messages.push({ role: "user", content });
    },

    addAssistantMessage(content: Anthropic.ContentBlock[]): void {
      messages.push({
        role: "assistant",
        content: content as Anthropic.ContentBlockParam[],
      });
    },

    addToolResult(toolUseId: string, result: string, isError: boolean): void {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: toolUseId,
            content: result,
            is_error: isError,
          },
        ],
      });
    },

    getMessages(): readonly Anthropic.MessageParam[] {
      return messages;
    },

    getTokenEstimate(): number {
      return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
    },

    getTokenBudget(): number {
      return tokenBudget;
    },

    async pruneIfNeeded(): Promise<void> {
      const currentTokens = this.getTokenEstimate();
      const pruneThreshold = tokenBudget * 0.8; // prune at 80% capacity

      if (currentTokens <= pruneThreshold) {
        return;
      }

      logger.info(
        { currentTokens, pruneThreshold, tokenBudget, messageCount: messages.length },
        "Working memory approaching budget, pruning"
      );

      // Strategy: summarize the oldest message pairs (skip the first user message = goal)
      // Keep at least the first message (goal) and last 4 messages (recent context)
      if (messages.length <= 5) {
        return; // nothing safe to prune
      }

      const messagesToSummarize = messages.slice(1, -4);
      if (messagesToSummarize.length === 0) {
        return;
      }

      // Build a text representation of old messages for summarization
      const oldContext = messagesToSummarize
        .map((msg) => {
          const role = msg.role;
          const content = typeof msg.content === "string"
            ? msg.content
            : JSON.stringify(msg.content).substring(0, 500);
          return `[${role}]: ${content}`;
        })
        .join("\n");

      let summary: string;
      try {
        const client = await deps.getClient();
        if (client) {
          const response = await client.messages.create({
            model: deps.model,
            max_tokens: 500,
            messages: [
              {
                role: "user",
                content: `Summarize the following agent conversation history in 2-3 concise sentences, preserving key facts, decisions, and tool results:\n\n${oldContext.substring(0, 8000)}`,
              },
            ],
          });
          const textBlock = response.content.find((b) => b.type === "text");
          summary = textBlock && textBlock.type === "text"
            ? textBlock.text
            : "Previous context was pruned for memory management.";
        } else {
          // Fallback: truncate without AI summarization
          summary = `Previous ${messagesToSummarize.length} messages pruned. Key context: ${oldContext.substring(0, 500)}...`;
        }
      } catch (error) {
        logger.warn({ error }, "Failed to summarize messages, using truncation fallback");
        summary = `Previous ${messagesToSummarize.length} messages pruned. Key context: ${oldContext.substring(0, 500)}...`;
      }

      // Replace old messages with summary
      const goalMessage = messages[0]!;
      const recentMessages = messages.slice(-4);
      messages.length = 0;
      messages.push(goalMessage);
      messages.push({
        role: "user",
        content: `[Context Summary]: ${summary}`,
      });
      // Need an assistant acknowledgment to maintain valid alternation
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: "Understood. Continuing with the summarized context." }],
      });
      messages.push(...recentMessages);

      logger.info(
        {
          prunedMessages: messagesToSummarize.length,
          newTokenEstimate: this.getTokenEstimate(),
          remainingMessages: messages.length,
        },
        "Working memory pruned"
      );
    },

    clear(): void {
      messages.length = 0;
    },
  };
}
