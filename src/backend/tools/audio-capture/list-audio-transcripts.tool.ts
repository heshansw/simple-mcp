import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { AudioTranscriptsRepository } from "../../db/repositories/audio-transcripts.repository.js";

export const ListAudioTranscriptsInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20).describe("Max transcripts to return"),
});

export type ListAudioTranscriptsToolDeps = {
  audioTranscriptsRepo: AudioTranscriptsRepository;
  logger: Logger;
};

export function registerListAudioTranscriptsTool(
  server: McpServer,
  deps: ListAudioTranscriptsToolDeps
): void {
  server.tool(
    "audio_list_transcripts",
    "List recent locally-captured meeting transcripts",
    ListAudioTranscriptsInputSchema.shape,
    async (args) => {
      const input = ListAudioTranscriptsInputSchema.parse(args);
      const transcripts = await deps.audioTranscriptsRepo.findRecent(input.limit);

      if (transcripts.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No audio transcripts found. Use the Chrome extension to record a meeting." }],
        };
      }

      const lines = [
        `## Audio Transcripts (${transcripts.length})`,
        ``,
      ];

      for (const t of transcripts) {
        const date = new Date(t.startTime).toLocaleString();
        const mins = Math.round(t.durationSeconds / 60);
        lines.push(`### ${t.meetingTitle || "Untitled"}`);
        lines.push(`- **ID:** ${t.id}`);
        lines.push(`- **Date:** ${date}`);
        lines.push(`- **Duration:** ${mins} min`);
        lines.push(`- **Segments:** ${t.segmentCount}`);
        lines.push(`- **Language:** ${t.language}`);
        lines.push(`- **Model:** ${t.whisperModel}`);
        lines.push(``);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
