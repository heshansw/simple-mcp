import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { WhisperTranscriptionServiceResult } from "../../services/whisper-transcription.service.js";
import { domainErrorMessage } from "../../../shared/result.js";

export const CheckAudioPrerequisitesInputSchema = z.object({});

export type CheckAudioPrerequisitesToolDeps = {
  whisperService: WhisperTranscriptionServiceResult;
  logger: Logger;
};

export function registerCheckAudioPrerequisitesTool(
  server: McpServer,
  deps: CheckAudioPrerequisitesToolDeps
): void {
  server.tool(
    "audio_check_prerequisites",
    "Check if ffmpeg and whisper.cpp are installed for local audio transcription",
    CheckAudioPrerequisitesInputSchema.shape,
    async () => {
      const result = await deps.whisperService.checkPrerequisites();
      if (result._tag === "Err") {
        return {
          content: [{ type: "text" as const, text: `Error: ${domainErrorMessage(result.error)}` }],
          isError: true,
        };
      }

      const s = result.value;
      const ffmpegHint = s.sandboxMode === "docker" ? "pnpm docker:audio:build" : "brew install ffmpeg";
      const whisperHint = s.sandboxMode === "docker" ? "pnpm docker:audio:build" : "brew install whisper-cpp";
      const lines = [
        `## Audio Prerequisites Check`,
        ``,
        `- Sandbox mode: **${s.sandboxMode}**`,
        ...(s.containerRunning !== null
          ? [`- Docker container: ${s.containerRunning ? "✓ running" : "✗ NOT running — pnpm docker:audio:up"}`]
          : []),
        `- ffmpeg: ${s.hasFfmpeg ? `✓ installed (${s.ffmpegVersion})` : `✗ NOT found — ${ffmpegHint}`}`,
        `- whisper.cpp: ${s.hasWhisper ? `✓ installed (${s.whisperVersion})` : `✗ NOT found — ${whisperHint}`}`,
        `- Whisper model: ${s.modelPath ? `✓ found at ${s.modelPath}` : "✗ NOT found"}`,
        ``,
        `### Diagnostics`,
        ...s.diagnosticMessages.map((m) => `- ${m}`),
      ];

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
