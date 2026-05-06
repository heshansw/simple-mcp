import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type {
  GoogleMeetServiceResult,
  Participant,
  TranscriptEntry,
} from "../../services/google-meet.service.js";
import { domainErrorMessage } from "../../../shared/result.js";

export const GetTranscriptInputSchema = z.object({
  conference_record_name: z
    .string()
    .min(1)
    .describe("Conference record name (e.g. conferenceRecords/abc123)"),
  format: z
    .enum(["raw", "dialogue"])
    .default("dialogue")
    .describe("Output format: 'dialogue' for timestamped speaker lines, 'raw' for JSON entries"),
});

export type GetTranscriptToolDeps = {
  googleMeetService: GoogleMeetServiceResult;
  logger: Logger;
};

function buildParticipantMap(
  participants: Participant[]
): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of participants) {
    const displayName =
      p.signedinUser?.displayName ??
      p.anonymousUser?.displayName ??
      p.phoneUser?.displayName ??
      "Unknown";
    map.set(p.name, displayName);
  }
  return map;
}

function formatDuration(offset: string): string {
  // offset is like "120.5s" — parse seconds and format as HH:MM:SS
  const seconds = parseFloat(offset.replace("s", ""));
  if (isNaN(seconds)) return offset;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function registerGetTranscriptTool(
  server: McpServer,
  deps: GetTranscriptToolDeps
): void {
  server.tool(
    "google_meet_get_transcript",
    "Fetch the full transcript for a Google Meet conference record, with speaker attribution and timestamps",
    GetTranscriptInputSchema.shape,
    async (args) => {
      const input = GetTranscriptInputSchema.parse(args);
      const { conference_record_name, format } = input;

      // List transcripts for this conference record
      const transcriptsResult = await deps.googleMeetService.listTranscripts(conference_record_name);
      if (transcriptsResult._tag === "Err") {
        return {
          content: [{ type: "text" as const, text: `Error listing transcripts: ${domainErrorMessage(transcriptsResult.error)}` }],
          isError: true,
        };
      }

      const transcripts = transcriptsResult.value;
      if (transcripts.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No transcripts found for ${conference_record_name}. The meeting may not have had transcription enabled, or the transcript is still processing.`,
          }],
        };
      }

      // Fetch all entries from all transcripts
      const allEntries: TranscriptEntry[] = [];
      for (const transcript of transcripts) {
        const entriesResult = await deps.googleMeetService.getTranscriptEntries(transcript.name);
        if (entriesResult._tag === "Err") {
          return {
            content: [{ type: "text" as const, text: `Error fetching entries for ${transcript.name}: ${domainErrorMessage(entriesResult.error)}` }],
            isError: true,
          };
        }
        allEntries.push(...entriesResult.value);
      }

      if (allEntries.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `Transcript exists but contains no entries for ${conference_record_name}.`,
          }],
        };
      }

      if (format === "raw") {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ transcriptCount: transcripts.length, entryCount: allEntries.length, entries: allEntries }, null, 2),
          }],
        };
      }

      // Dialogue format — resolve participant names
      const participantsResult = await deps.googleMeetService.listParticipants(conference_record_name);
      const participantMap = participantsResult._tag === "Ok"
        ? buildParticipantMap(participantsResult.value)
        : new Map<string, string>();

      const lines = [
        `## Meeting Transcript`,
        `**Conference:** ${conference_record_name}`,
        `**Entries:** ${allEntries.length}`,
        ``,
      ];

      for (const entry of allEntries) {
        const speaker = participantMap.get(entry.participant) ?? "Unknown";
        const timestamp = formatDuration(entry.startOffset);
        lines.push(`[${timestamp}] **${speaker}:** ${entry.text}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
