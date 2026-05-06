import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { MeetingAnalysesRepository } from "../../db/repositories/meeting-analyses.repository.js";
import type { EncryptionService } from "../../services/encryption.service.js";

export const GetMeetingSummaryInputSchema = z.object({
  transcript_id: z
    .string()
    .min(1)
    .describe("The transcript ID to get the summary for"),
});

export type GetMeetingSummaryToolDeps = {
  meetingAnalysesRepo: MeetingAnalysesRepository;
  encryptionService: EncryptionService;
  logger: Logger;
};

export function registerGetMeetingSummaryTool(
  server: McpServer,
  deps: GetMeetingSummaryToolDeps
): void {
  server.tool(
    "audio_get_meeting_summary",
    "Get the auto-generated summary for a locally-captured meeting transcript, including referenced Jira tickets, GitHub PRs, and action items",
    GetMeetingSummaryInputSchema.shape,
    async (args) => {
      const input = GetMeetingSummaryInputSchema.parse(args);
      const analyses = await deps.meetingAnalysesRepo.findByTranscriptId(
        input.transcript_id
      );

      if (analyses.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                status: "not_found",
                message: `No summary found for transcript ${input.transcript_id}. It may still be processing — summaries are generated automatically after transcription.`,
              }),
            },
          ],
        };
      }

      // Return the most recent analysis
      const latest = analyses[0]!;
      const decrypted = deps.encryptionService.decrypt(
        latest.encryptedContent,
        latest.iv
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `## ${latest.title}\n**Analysis Type:** ${latest.analysisType} | **Generated:** ${latest.createdAt} | **Model:** ${latest.model || "unknown"}\n\n${decrypted}`,
          },
        ],
      };
    }
  );
}
