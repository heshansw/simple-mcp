import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { AudioTranscriptsRepository } from "../../db/repositories/audio-transcripts.repository.js";

export const SearchAudioTranscriptsInputSchema = z.object({
  query: z.string().min(1).describe("Full-text search query"),
  limit: z.number().int().min(1).max(50).default(10).describe("Max results"),
});

export type SearchAudioTranscriptsToolDeps = {
  audioTranscriptsRepo: AudioTranscriptsRepository;
  logger: Logger;
};

export function registerSearchAudioTranscriptsTool(
  server: McpServer,
  deps: SearchAudioTranscriptsToolDeps
): void {
  server.tool(
    "audio_search_transcripts",
    "Search across locally-captured meeting transcripts by keyword (full-text search)",
    SearchAudioTranscriptsInputSchema.shape,
    async (args) => {
      const input = SearchAudioTranscriptsInputSchema.parse(args);
      const results = await deps.audioTranscriptsRepo.searchFts(input.query, input.limit);

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No matches found for "${input.query}".` }],
        };
      }

      const lines = [
        `## Search Results for "${input.query}"`,
        `**Matches:** ${results.length}`,
        ``,
      ];

      for (const r of results) {
        const date = r.startTime ? new Date(r.startTime).toLocaleString() : "Unknown";
        lines.push(`### ${r.meetingTitle || "Untitled"} (${date})`);
        lines.push(`- **Snippet:** ${r.snippet}`);
        lines.push(`- **ID:** ${r.transcriptId}`);
        lines.push(``);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
