import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";

export const CheckAvailabilityInputSchema = z.object({
  emails: z
    .array(z.string().email())
    .min(1, "At least one email is required")
    .max(50, "Maximum 50 emails allowed"),
  time_min: z.string().min(1, "time_min is required (ISO 8601)"),
  time_max: z.string().min(1, "time_max is required (ISO 8601)"),
});

export type CheckAvailabilityInput = z.infer<typeof CheckAvailabilityInputSchema>;

export type CheckAvailabilityToolDeps = {
  googleCalendarService: {
    checkAvailability(
      emails: string[],
      timeMin: string,
      timeMax: string
    ): Promise<Result<unknown, DomainError>>;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerCheckAvailabilityTool(
  server: McpServer,
  deps: CheckAvailabilityToolDeps
): void {
  server.tool(
    "google_calendar_check_availability",
    "Check free/busy availability for one or more attendees over a time range",
    CheckAvailabilityInputSchema.shape,
    async (args) => {
      try {
        const input = CheckAvailabilityInputSchema.parse(args);
        deps.logger.info("Checking availability", {
          emailCount: input.emails.length,
        });

        const result = await deps.googleCalendarService.checkAvailability(
          input.emails,
          input.time_min,
          input.time_max
        );

        if (isErr(result)) {
          const errorMsg = `Failed to check availability: ${"message" in result.error ? result.error.message : String(result.error)}`;
          deps.logger.error(errorMsg);
          return {
            content: [{ type: "text" as const, text: errorMsg }],
            isError: true,
          };
        }

        const successText = JSON.stringify(result.value, null, 2);
        return {
          content: [{ type: "text" as const, text: successText }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: "text" as const, text: `Error checking availability: ${errorMsg}` },
          ],
          isError: true,
        };
      }
    }
  );
}
