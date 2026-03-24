import { z } from "zod";

export const ConnectionStatusSchema = z.enum([
  "connected",
  "disconnected",
  "error",
  "refreshing",
]);

export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;

export const AuthMethodSchema = z.enum([
  "oauth2",
  "api_token",
  "personal_access_token",
]);

export type AuthMethod = z.infer<typeof AuthMethodSchema>;

export const ConnectionConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  integrationType: z.enum(["jira", "github", "google-calendar"]),
  baseUrl: z.string().url().optional(),
  authMethod: AuthMethodSchema,
  status: ConnectionStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ConnectionConfig = z.infer<typeof ConnectionConfigSchema>;
