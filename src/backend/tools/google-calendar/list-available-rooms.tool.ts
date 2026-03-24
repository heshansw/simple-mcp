import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";

export const ListAvailableRoomsInputSchema = z.object({
  time_min: z.string().min(1, "time_min is required (ISO 8601)"),
  time_max: z.string().min(1, "time_max is required (ISO 8601)"),
  min_capacity: z.number().int().positive().nullish(),
});

export type ListAvailableRoomsInput = z.infer<typeof ListAvailableRoomsInputSchema>;

export type ListAvailableRoomsToolDeps = {
  googleCalendarService: {
    listAvailableRooms(
      timeMin: string,
      timeMax: string,
      minCapacity?: number
    ): Promise<Result<unknown, DomainError>>;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerListAvailableRoomsTool(
  server: McpServer,
  deps: ListAvailableRoomsToolDeps
): void {
  server.tool(
    "google_calendar_list_available_rooms",
    "Query available meeting rooms filtered by time window and optional minimum capacity",
    ListAvailableRoomsInputSchema.shape,
    async (args) => {
      try {
        const input = ListAvailableRoomsInputSchema.parse(args);
        deps.logger.info("Listing available rooms", {
          timeMin: input.time_min,
          timeMax: input.time_max,
        });

        const result = await deps.googleCalendarService.listAvailableRooms(
          input.time_min,
          input.time_max,
          input.min_capacity ?? undefined
        );

        if (isErr(result)) {
          const errorMsg = `Failed to list rooms: ${"message" in result.error ? result.error.message : String(result.error)}`;
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
            { type: "text" as const, text: `Error listing available rooms: ${errorMsg}` },
          ],
          isError: true,
        };
      }
    }
  );
}
