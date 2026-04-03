import type Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";

export type ObservationSummarizerDeps = {
  readonly logger: Logger;
  readonly getClient: () => Promise<Anthropic | null>;
  readonly model: string;
  readonly threshold: number;
};

export type ObservationSummarizer = {
  readonly summarize: (
    toolOutput: string,
    goal: string,
    maxChars: number
  ) => Promise<string>;
  readonly shouldSummarize: (toolOutput: string) => boolean;
};

/**
 * Try to extract and filter a JSON object, keeping only relevant top-level fields.
 * Returns null if the output is not valid JSON or filtering doesn't reduce size enough.
 */
function tryJsonFilter(output: string, maxChars: number): string | null {
  try {
    const parsed: unknown = JSON.parse(output);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    // If it's an array, truncate to first N items
    if (Array.isArray(parsed)) {
      const truncated = parsed.slice(0, 10);
      const result = JSON.stringify(truncated, null, 2);
      if (result.length <= maxChars) {
        const suffix = parsed.length > 10
          ? `\n... (${parsed.length - 10} more items truncated)`
          : "";
        return result + suffix;
      }
      // Further truncate each item
      const minimal = truncated.map((item) => {
        if (typeof item === "object" && item !== null) {
          const keys = Object.keys(item as Record<string, unknown>);
          const kept = keys.slice(0, 5);
          const filtered: Record<string, unknown> = {};
          for (const key of kept) {
            const val = (item as Record<string, unknown>)[key];
            filtered[key] = typeof val === "string" && val.length > 200
              ? val.substring(0, 200) + "..."
              : val;
          }
          return filtered;
        }
        return item;
      });
      return JSON.stringify(minimal, null, 2) +
        `\n... (showing first ${truncated.length} of ${parsed.length} items, truncated fields)`;
    }

    // For objects, keep first N keys
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length <= 10) {
      // Just truncate long string values
      const truncated: Record<string, unknown> = {};
      for (const key of keys) {
        const val = record[key];
        truncated[key] = typeof val === "string" && val.length > 300
          ? val.substring(0, 300) + "..."
          : val;
      }
      const result = JSON.stringify(truncated, null, 2);
      if (result.length <= maxChars) {
        return result;
      }
    }

    return null; // filtering didn't help enough
  } catch {
    return null; // not valid JSON
  }
}

export function createObservationSummarizer(
  deps: ObservationSummarizerDeps
): ObservationSummarizer {
  const { logger, threshold } = deps;

  return {
    shouldSummarize(toolOutput: string): boolean {
      return toolOutput.length > threshold;
    },

    async summarize(
      toolOutput: string,
      goal: string,
      maxChars: number
    ): Promise<string> {
      // Step 1: try JSON field filtering
      const jsonFiltered = tryJsonFilter(toolOutput, maxChars);
      if (jsonFiltered !== null) {
        logger.debug(
          { originalLength: toolOutput.length, filteredLength: jsonFiltered.length },
          "Observation summarized via JSON filtering"
        );
        return jsonFiltered;
      }

      // Step 2: try Claude-based summarization
      try {
        const client = await deps.getClient();
        if (client) {
          const response = await client.messages.create({
            model: deps.model,
            max_tokens: 1000,
            messages: [
              {
                role: "user",
                content: `Summarize the following tool output, keeping only information relevant to this goal: "${goal}"

Tool output (${toolOutput.length} chars):
${toolOutput.substring(0, 12000)}

Provide a concise summary (max ${Math.floor(maxChars / 4)} words) that preserves all facts, numbers, and identifiers relevant to the goal.`,
              },
            ],
          });

          const textBlock = response.content.find((b) => b.type === "text");
          if (textBlock && textBlock.type === "text") {
            logger.debug(
              { originalLength: toolOutput.length, summaryLength: textBlock.text.length },
              "Observation summarized via Claude"
            );
            return textBlock.text;
          }
        }
      } catch (error) {
        logger.warn({ error }, "Claude summarization failed, falling back to truncation");
      }

      // Step 3: fallback — simple truncation
      const truncated = toolOutput.substring(0, maxChars);
      const suffix = toolOutput.length > maxChars
        ? `\n... (truncated from ${toolOutput.length} chars)`
        : "";
      return truncated + suffix;
    },
  };
}
