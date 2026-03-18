import { z } from "zod";
import type { Result } from "@shared/result.js";
import { ok, err } from "@shared/result.js";

const LogLevelSchema = z.enum([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);

const TransportSchema = z.enum(["stdio", "sse", "http"]);

export const EnvSchema = z
  .object({
    CLAUDE_MCP_DB_PATH: z
      .string()
      .default(() => {
        const homeDir =
          process.env.HOME ||
          process.env.USERPROFILE ||
          (process.platform === "win32" ? process.env.HOMEDRIVE : "");
        return `${homeDir}/.simple-mcp/data.db`;
      })
      .describe("Path to SQLite database file"),

    CLAUDE_MCP_ADMIN_PORT: z.coerce
      .number()
      .int()
      .positive()
      .default(3101)
      .describe("Admin panel HTTP server port"),

    CLAUDE_MCP_LOG_LEVEL: LogLevelSchema.default("info").describe(
      "Log level for pino logger"
    ),

    CLAUDE_MCP_TRANSPORT: TransportSchema.default("stdio").describe(
      "MCP server transport protocol"
    ),

    CLAUDE_MCP_ENCRYPTION_KEY: z
      .string()
      .min(32, "Encryption key must be at least 32 characters")
      .optional()
      .describe("Base64-encoded AES-256 encryption key for credentials"),

    ANTHROPIC_API_KEY: z
      .string()
      .optional()
      .describe("Anthropic API key for AI-powered PR reviews. Can also be stored as a Claude connection credential."),
  })
  .strip();

export type EnvConfig = z.infer<typeof EnvSchema>;

export type EnvValidationError = {
  readonly _tag: "EnvValidationError";
  readonly message: string;
  readonly details: Record<string, string[]>;
};

export function loadEnv(): Result<EnvConfig, EnvValidationError> {
  const parseResult = EnvSchema.safeParse(process.env);

  if (!parseResult.success) {
    const details: Record<string, string[]> = {};
    parseResult.error.issues.forEach((issue) => {
      const path = issue.path.join(".");
      if (!details[path]) {
        details[path] = [];
      }
      details[path]!.push(issue.message);
    });

    return err({
      _tag: "EnvValidationError",
      message: "Failed to validate environment variables",
      details,
    });
  }

  return ok(parseResult.data);
}
