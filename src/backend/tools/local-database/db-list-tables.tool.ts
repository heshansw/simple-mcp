import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { DatabaseQueryService } from "../../services/database-query.service.js";
import type { DbQueryActivityRepository } from "../../db/repositories/db-query-activity.repository.js";
import { estimateTokens } from "../../services/database-query.service.js";

export const DbListTablesInputSchema = z.object({
  connection_id: z.string().min(1).describe("The database connection ID"),
  schema_name: z.string().min(1).describe("The schema/database name"),
});

export type DbListTablesDeps = {
  dbQueryService: DatabaseQueryService;
  dbQueryActivityRepo: DbQueryActivityRepository;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

export function registerDbListTablesTool(
  server: McpServer,
  deps: DbListTablesDeps
): void {
  server.tool(
    "db_list_tables",
    "List all tables in a given schema. Only tables permitted by the admin-configured permissions are returned.",
    DbListTablesInputSchema.shape,
    async (args) => {
      const start = Date.now();
      try {
        const input = DbListTablesInputSchema.parse(args);
        deps.logger.info("db_list_tables", { connectionId: input.connection_id, schema: input.schema_name });

        const result = await deps.dbQueryService.listTables(input.connection_id, input.schema_name);
        const duration = Date.now() - start;
        const isOk = result._tag === "Ok";
        const outputText = isOk
          ? JSON.stringify(result.value, null, 2)
          : `Error: ${domainErrorMessage(result.error)}`;

        deps.dbQueryActivityRepo
          .record({
            connectionId: input.connection_id,
            toolName: "db_list_tables",
            dialect: "unknown",
            schemaName: input.schema_name,
            resultSizeBytes: outputText.length,
            inputTokensEstimate: estimateTokens(JSON.stringify(args)),
            outputTokensEstimate: estimateTokens(outputText),
            durationMs: duration,
            success: isOk ? 1 : 0,
            errorTag: !isOk ? result.error._tag : null,
            rowCount: isOk ? result.value.tables.length : 0,
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
