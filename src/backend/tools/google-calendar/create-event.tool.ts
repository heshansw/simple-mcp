import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";

export const CreateEventInputSchema = z.object({
  title: z.string().min(1, "Event title is required"),
  start: z.string().min(1, "Start datetime is required (ISO 8601)"),
  end: z.string().min(1, "End datetime is required (ISO 8601)"),
  description: z.string().nullish(),
  attendees: z.array(z.string().email()).optional().default([]),
  room_resource_email: z.string().nullish(),
  add_meet_link: z.boolean().default(false),
  timezone: z.string().optional().describe("IANA timezone string"),
});

export type CreateEventInput = z.infer<typeof CreateEventInputSchema>;

export type CreateEventToolDeps = {
  googleCalendarService: {
    createEvent(params: {
      title: string;
      start: string;
      end: string;
      description?: string;
      attendees?: string[];
      roomResourceEmail?: string;
      addMeetLink?: boolean;
      timezone?: string;
    }): Promise<Result<unknown, DomainError>>;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerCreateEventTool(
  server: McpServer,
  deps: CreateEventToolDeps
): void {
  server.tool(
    "google_calendar_create_event",
    "Create a new Google Calendar event with optional attendees, room, Meet link, and description",
    CreateEventInputSchema.shape,
    async (args) => {
      try {
        const input = CreateEventInputSchema.parse(args);
        deps.logger.info("Creating Google Calendar event", { title: input.title });

        const createParams: Parameters<typeof deps.googleCalendarService.createEvent>[0] = {
          title: input.title,
          start: input.start,
          end: input.end,
          addMeetLink: input.add_meet_link,
        };
        if (input.description) createParams.description = input.description;
        if (input.attendees.length > 0) createParams.attendees = input.attendees;
        if (input.room_resource_email) createParams.roomResourceEmail = input.room_resource_email;
        if (input.timezone) createParams.timezone = input.timezone;

        const result = await deps.googleCalendarService.createEvent(createParams);

        if (isErr(result)) {
          const errorMsg = `Failed to create event: ${"message" in result.error ? result.error.message : String(result.error)}`;
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
            { type: "text" as const, text: `Error creating calendar event: ${errorMsg}` },
          ],
          isError: true,
        };
      }
    }
  );
}
