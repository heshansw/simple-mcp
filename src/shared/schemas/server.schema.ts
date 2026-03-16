import { z } from "zod";

export const TransportModeSchema = z.enum(["stdio", "sse", "http"]);

export type TransportMode = z.infer<typeof TransportModeSchema>;

export const LogLevelSchema = z.enum([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);

export type LogLevel = z.infer<typeof LogLevelSchema>;

export const ServerSettingsSchema = z.object({
  transportMode: TransportModeSchema,
  logLevel: LogLevelSchema,
  adminPort: z.number().int().positive(),
  enableCors: z.boolean().default(false),
  rateLimitRpm: z.number().int().positive().default(600),
});

export type ServerSettings = z.infer<typeof ServerSettingsSchema>;

export const ServerHealthSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  uptime: z.number().nonnegative(),
  activeConnections: z.number().int().nonnegative(),
  enabledAgents: z.number().int().nonnegative(),
  lastHealthCheck: z.string().datetime(),
});

export type ServerHealth = z.infer<typeof ServerHealthSchema>;
