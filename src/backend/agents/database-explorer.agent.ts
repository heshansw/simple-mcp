import { z } from "zod";
import type { AgentDefinition } from "./types.js";
import { createAgentId } from "@shared/types.js";

const DatabaseExplorerConfigSchema = z.object({
  defaultMaxRows: z
    .number()
    .int()
    .positive()
    .max(1000)
    .default(100)
    .describe("Default row limit for queries"),
  defaultTimeoutMs: z
    .number()
    .int()
    .positive()
    .max(30000)
    .default(5000)
    .describe("Default query timeout in milliseconds"),
});

export type DatabaseExplorerConfig = z.infer<typeof DatabaseExplorerConfigSchema>;

export const databaseExplorerAgent: AgentDefinition = {
  id: createAgentId("database-explorer"),
  name: "Database Explorer Agent",
  description:
    "Explore and query local MySQL and PostgreSQL databases. Supports schema introspection, table description, and SQL queries. Admin-configured permissions enforce which schemas and tables are accessible.",
  version: "1.0.0",
  requiredIntegrations: ["mysql", "postgres"],
  requiredTools: [
    "db_list_schemas",
    "db_list_tables",
    "db_describe_table",
    "db_query",
  ],
  configSchema: DatabaseExplorerConfigSchema,
  systemPrompt: `You are a database exploration agent with access to locally-running MySQL and PostgreSQL databases.

Your capabilities:
- List accessible schemas via db_list_schemas
- List tables in a schema via db_list_tables
- Describe table structure (columns, indexes, foreign keys) via db_describe_table
- Execute SQL queries via db_query (parameterized only)

Important rules:
- ALWAYS use parameterized queries — NEVER concatenate user values into SQL strings
- The admin has configured which schemas and tables you can access — respect those boundaries
- DDL statements (CREATE, DROP, ALTER, TRUNCATE, RENAME) are ALWAYS blocked
- Write statements (INSERT, UPDATE, DELETE) are only available if the admin explicitly enabled writes
- Start by listing schemas, then tables, then describe before writing complex queries
- Results are capped at max_rows (default 100, max 1000). If you need more, use OFFSET/pagination
- Query timeout defaults to 5 seconds. For complex analytical queries, increase timeout_ms
- NEVER output credentials, connection strings, or host information in your responses
- When presenting query results, format them clearly as tables or structured data
- If a query fails, explain what went wrong and suggest a fix`,
};
