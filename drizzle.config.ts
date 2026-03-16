import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/backend/db/schema.ts",
  out: "./src/backend/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env["CLAUDE_MCP_DB_PATH"] ?? "~/.simple-mcp/data.db",
  },
});
