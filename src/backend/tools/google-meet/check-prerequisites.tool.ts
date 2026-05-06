import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Logger } from "pino";
import type { GoogleMeetServiceResult } from "../../services/google-meet.service.js";
import { domainErrorMessage } from "../../../shared/result.js";

export const CheckPrerequisitesInputSchema = z.object({});

export type CheckPrerequisitesToolDeps = {
  googleMeetService: GoogleMeetServiceResult;
  logger: Logger;
};

export function registerCheckPrerequisitesTool(
  server: McpServer,
  deps: CheckPrerequisitesToolDeps
): void {
  server.tool(
    "google_meet_check_prerequisites",
    "Check Google Meet integration prerequisites — verifies OAuth token, Meet API scope, and transcript access",
    CheckPrerequisitesInputSchema.shape,
    async () => {
      const result = await deps.googleMeetService.checkPrerequisites();
      if (result._tag === "Err") {
        return {
          content: [{ type: "text" as const, text: `Error: ${domainErrorMessage(result.error)}` }],
          isError: true,
        };
      }

      const status = result.value;
      const lines = [
        `## Google Meet Prerequisites Check`,
        ``,
        `- OAuth Token: ${status.hasValidToken ? "✓ Valid" : "✗ Missing or invalid"}`,
        `- Meet API Scope: ${status.hasMeetScope ? "✓ Granted" : "✗ Not granted"}`,
        `- Can List Meetings: ${status.canListMeetings ? "✓ Yes" : "✗ No"}`,
        ``,
        `### Diagnostics`,
        ...status.diagnosticMessages.map((m) => `- ${m}`),
      ];

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
