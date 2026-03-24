import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";

export const ListEventsInputSchema = z.object({
  calendar_id: z.string().default("primary"),
  time_min: z
    .string()
    .default(() => new Date().toISOString())
    .describe("ISO 8601 datetime (default: now)"),
  time_max: z
    .string()
    .default(() => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
    .describe("ISO 8601 datetime (default: now + 7 days)"),
  max_results: z.number().int().min(1).max(250).default(25),
});

export type ListEventsInput = z.infer<typeof ListEventsInputSchema>;

export type ListEventsToolDeps = {
  googleCalendarService: {
    listEvents(
      calendarId: string,
      timeMin: string,
      timeMax: string,
      maxResults: number
    ): Promise<Result<unknown, DomainError>>;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerListEventsTool(
  server: McpServer,
  deps: ListEventsToolDeps
): void {
  server.tool(
    "google_calendar_list_events",
    "List upcoming events from a Google Calendar",
    ListEventsInputSchema.shape,
    async (args) => {
      try {
        const input = ListEventsInputSchema.parse(args);
        deps.logger.info("Listing Google Calendar events", {
          calendarId: input.calendar_id,
        });

        const result = await deps.googleCalendarService.listEvents(
          input.calendar_id,
          input.time_min,
          input.time_max,
          input.max_results
        );

        if (isErr(result)) {
          const errorMsg = `Failed to list events: ${"message" in result.error ? result.error.message : String(result.error)}`;
          deps.logger.error(errorMsg);
          return {
            content: [{ type: "text" as const, text: errorMsg }],
            isError: true,
          };
        }

        const successText = JSON.stringify(result.value, null, 2);
        return {
          content: [{ type: "text" as const, text: successText }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: "text" as const, text: `Error listing calendar events: ${errorMsg}` },
          ],
          isError: true,
        };
      }
    }
  );
}
