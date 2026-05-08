import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { AudioTranscriptsRepository } from "../../db/repositories/audio-transcripts.repository.js";
import type { EncryptionService } from "../../services/encryption.service.js";

export const GetAudioTranscriptInputSchema = z.object({
  transcript_id: z.string().min(1).describe("Audio transcript ID"),
  format: z.enum(["dialogue", "raw"]).default("dialogue").describe("Output format"),
});

export type GetAudioTranscriptToolDeps = {
  audioTranscriptsRepo: AudioTranscriptsRepository;
  encryptionService: EncryptionService;
  logger: Logger;
};

export function registerGetAudioTranscriptTool(
  server: McpServer,
  deps: GetAudioTranscriptToolDeps
): void {
  server.tool(
    "audio_get_transcript",
    "Get the full text of a locally-captured meeting transcript",
    GetAudioTranscriptInputSchema.shape,
    async (args) => {
      const input = GetAudioTranscriptInputSchema.parse(args);
      const transcript = await deps.audioTranscriptsRepo.findById(input.transcript_id);

      if (!transcript) {
        return {
          content: [{ type: "text" as const, text: `Transcript not found: ${input.transcript_id}` }],
          isError: true,
        };
      }

      const raw = deps.encryptionService.decrypt(transcript.encryptedContent, transcript.iv);
      const content = JSON.parse(raw) as {
        segments: Array<{ startTime: string; endTime: string; text: string; speaker?: string }>;
        fullText: string;
      };

      if (input.format === "raw") {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            id: transcript.id,
            meetingTitle: transcript.meetingTitle,
            startTime: transcript.startTime,
            endTime: transcript.endTime,
            durationSeconds: transcript.durationSeconds,
            segmentCount: transcript.segmentCount,
            ...content,
          }, null, 2) }],
        };
      }

      // Dialogue format
      const date = new Date(transcript.startTime).toLocaleString();
      const mins = Math.round(transcript.durationSeconds / 60);
      const lines = [
        `## ${transcript.meetingTitle || "Meeting Transcript"}`,
        `**Date:** ${date} | **Duration:** ${mins} min | **Segments:** ${transcript.segmentCount}`,
        ``,
      ];

      for (const seg of content.segments) {
        lines.push(`[${seg.startTime}] ${seg.text}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
