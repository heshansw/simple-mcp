import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { GoogleMeetServiceResult } from "../../services/google-meet.service.js";

export const ListMeetingsInputSchema = z.object({
  since_hours: z
    .number()
    .int()
    .positive()
    .default(24)
    .describe("How many hours back to look for meetings (default: 24)"),
  page_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe("Maximum number of meetings to return per page"),
  page_token: z
    .string()
    .optional()
    .describe("Pagination token from a previous response"),
});

export type ListMeetingsToolDeps = {
  googleMeetService: GoogleMeetServiceResult;
  logger: Logger;
};

export function registerListMeetingsTool(
  server: McpServer,
  deps: ListMeetingsToolDeps
): void {
  server.tool(
    "google_meet_list_meetings",
    "List recent Google Meet conference records with metadata (times, participants)",
    ListMeetingsInputSchema.shape,
    async (args) => {
      const input = ListMeetingsInputSchema.parse(args);

      const sinceDate = new Date(Date.now() - input.since_hours * 60 * 60 * 1000);
      const filter = `end_time>${sinceDate.toISOString()}`;

      const result = await deps.googleMeetService.listConferenceRecords({
        filter,
        pageSize: input.page_size,
        pageToken: input.page_token,
      });

      if (result._tag === "Err") {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error.message}` }],
          isError: true,
        };
      }

      const { records, nextPageToken } = result.value;

      if (records.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No meetings found in the last ${input.since_hours} hours.`,
          }],
        };
      }

      const lines = [
        `## Recent Meetings (last ${input.since_hours}h)`,
        ``,
        `Found ${records.length} meeting(s).`,
        ``,
      ];

      for (const record of records) {
        const start = new Date(record.startTime).toLocaleString();
        const end = new Date(record.endTime).toLocaleString();
        lines.push(`### ${record.name}`);
        lines.push(`- **Start:** ${start}`);
        lines.push(`- **End:** ${end}`);
        lines.push(`- **Space:** ${record.space}`);
        lines.push(``);
      }

      if (nextPageToken) {
        lines.push(`_More results available. Use page_token: "${nextPageToken}" to get the next page._`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
