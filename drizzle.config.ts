import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/backend/db/schema.ts",
  out: "./src/backend/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: `file:${process.env["CLAUDE_MCP_DB_PATH"] ?? "~/.claude-mcp/data.db"}`,
  },
});
