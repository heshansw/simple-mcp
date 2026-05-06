import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { MeetTranscriptsRepository } from "../../db/repositories/meet-transcripts.repository.js";

export const SearchTranscriptsInputSchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("Full-text search query for meeting transcripts"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum number of results to return"),
});

export type SearchTranscriptsToolDeps = {
  meetTranscriptsRepo: MeetTranscriptsRepository;
  logger: Logger;
};

export function registerSearchTranscriptsTool(
  server: McpServer,
  deps: SearchTranscriptsToolDeps
): void {
  server.tool(
    "google_meet_search_transcripts",
    "Search cached Google Meet transcripts by keyword using full-text search",
    SearchTranscriptsInputSchema.shape,
    async (args) => {
      const input = SearchTranscriptsInputSchema.parse(args);

      const results = await deps.meetTranscriptsRepo.searchFts(input.query, input.limit);

      if (results.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No transcript matches found for "${input.query}". Transcripts are indexed during automatic sync (every 30 minutes) or when you manually trigger sync with google_meet_sync_transcripts.`,
          }],
        };
      }

      const lines = [
        `## Transcript Search Results`,
        `**Query:** "${input.query}"`,
        `**Matches:** ${results.length}`,
        ``,
      ];

      for (const result of results) {
        const meetingDate = result.meetingStartTime
          ? new Date(result.meetingStartTime).toLocaleString()
          : "Unknown";
        lines.push(`### Meeting: ${meetingDate}`);
        lines.push(`- **Speaker:** ${result.participantName}`);
        lines.push(`- **Snippet:** ${result.snippet}`);
        lines.push(`- **Transcript ID:** ${result.transcriptId}`);
        lines.push(``);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
