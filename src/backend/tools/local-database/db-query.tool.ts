import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { DatabaseQueryService } from "../../services/database-query.service.js";
import type { DbQueryActivityRepository } from "../../db/repositories/db-query-activity.repository.js";
import { estimateTokens } from "../../services/database-query.service.js";

export const DbQueryInputSchema = z.object({
  connection_id: z.string().min(1).describe("The database connection ID"),
  sql: z.string().min(1).describe("The SQL statement to execute"),
  params: z.array(z.unknown()).default([]).describe("Positional parameters for parameterized queries"),
  max_rows: z.number().int().min(1).max(1000).default(100).describe("Maximum rows to return (1-1000)"),
  timeout_ms: z.number().int().min(500).max(30000).default(5000).describe("Query timeout in milliseconds"),
});

export type DbQueryDeps = {
  dbQueryService: DatabaseQueryService;
  dbQueryActivityRepo: DbQueryActivityRepository;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

export function registerDbQueryTool(
  server: McpServer,
  deps: DbQueryDeps
): void {
  server.tool(
    "db_query",
    "Execute a SQL query against a registered database connection. Read-only by default; write operations require admin to enable writes. DDL is always blocked. Uses parameterized queries for safety. Only permitted schemas/tables are accessible.",
    DbQueryInputSchema.shape,
    async (args) => {
      const start = Date.now();
      try {
        const input = DbQueryInputSchema.parse(args);
        // Log connection_id only — never log the SQL or params which may contain sensitive data
        deps.logger.info("db_query", { connectionId: input.connection_id });

        const result = await deps.dbQueryService.query(
          input.connection_id,
          input.sql,
          input.params,
          input.max_rows,
          input.timeout_ms
        );
        const duration = Date.now() - start;
        const isOk = result._tag === "Ok";
        const outputText = isOk
          ? JSON.stringify(result.value, null, 2)
          : `Error: ${domainErrorMessage(result.error)}`;

        deps.dbQueryActivityRepo
          .record({
            connectionId: input.connection_id,
            toolName: "db_query",
            dialect: "unknown",
            sqlQuery: input.sql.slice(0, 500), // truncate for storage
            resultSizeBytes: outputText.length,
            inputTokensEstimate: estimateTokens(JSON.stringify(args)),
            outputTokensEstimate: estimateTokens(outputText),
            durationMs: duration,
            success: isOk ? 1 : 0,
            errorTag: !isOk ? result.error._tag : null,
            rowCount: isOk ? result.value.rowCount : 0,
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
