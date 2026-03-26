import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { DatabaseQueryService } from "../../services/database-query.service.js";
import type { DbQueryActivityRepository } from "../../db/repositories/db-query-activity.repository.js";
import { estimateTokens } from "../../services/database-query.service.js";

export const DbListSchemasInputSchema = z.object({
  connection_id: z.string().min(1).describe("The database connection ID"),
});

export type DbListSchemasDeps = {
  dbQueryService: DatabaseQueryService;
  dbQueryActivityRepo: DbQueryActivityRepository;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

export function registerDbListSchemasTool(
  server: McpServer,
  deps: DbListSchemasDeps
): void {
  server.tool(
    "db_list_schemas",
    "List all databases/schemas accessible via a registered database connection. Only schemas permitted by the admin-configured permissions are returned.",
    DbListSchemasInputSchema.shape,
    async (args) => {
      const start = Date.now();
      try {
        const input = DbListSchemasInputSchema.parse(args);
        deps.logger.info("db_list_schemas", { connectionId: input.connection_id });

        const result = await deps.dbQueryService.listSchemas(input.connection_id);
        const duration = Date.now() - start;
        const isOk = result._tag === "Ok";
        const outputText = isOk
          ? JSON.stringify(result.value, null, 2)
          : `Error: ${domainErrorMessage(result.error)}`;

        deps.dbQueryActivityRepo
          .record({
            connectionId: input.connection_id,
            toolName: "db_list_schemas",
            dialect: isOk ? result.value.dialect : "unknown",
            resultSizeBytes: outputText.length,
            inputTokensEstimate: estimateTokens(JSON.stringify(args)),
            outputTokensEstimate: estimateTokens(outputText),
            durationMs: duration,
            success: isOk ? 1 : 0,
            errorTag: !isOk ? result.error._tag : null,
            rowCount: isOk ? result.value.schemas.length : 0,
          })
          .catch((e) => deps.logger.error("Failed to record db activity", { error: e }));

        if (isErr(result)) {
          return {
            content: [{ type: "text" as const, text: outputText }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: outputText }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
