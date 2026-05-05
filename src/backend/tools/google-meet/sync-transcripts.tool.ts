import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { MaintenanceScheduler } from "../../maintenance/scheduler.js";

export const SyncTranscriptsInputSchema = z.object({});

export type SyncTranscriptsToolDeps = {
  scheduler: MaintenanceScheduler;
  logger: Logger;
};

export function registerSyncTranscriptsTool(
  server: McpServer,
  deps: SyncTranscriptsToolDeps
): void {
  server.tool(
    "google_meet_sync_transcripts",
    "Manually trigger a transcript sync — fetches new Google Meet transcripts and indexes them for search",
    SyncTranscriptsInputSchema.shape,
    async () => {
      try {
        await deps.scheduler.runNow("transcript-sync");
        return {
          content: [{
            type: "text" as const,
            text: "Transcript sync triggered successfully. New transcripts will be fetched, encrypted, and indexed for search.",
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error triggering transcript sync: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
