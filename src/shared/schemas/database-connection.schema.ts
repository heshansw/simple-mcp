import { z } from "zod";
import { ConnectionStatusSchema } from "./connection.schema.js";

export const DATABASE_DIALECTS = ["mysql", "postgres"] as const;
export const DatabaseDialectSchema = z.enum(DATABASE_DIALECTS);
export type DatabaseDialect = z.infer<typeof DatabaseDialectSchema>;

// ── Credentials shapes ──────────────────────────────────────────────

export const DbCredentialsUsernamePasswordSchema = z.object({
  method: z.literal("username_password"),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

export const DbCredentialsConnectionStringSchema = z.object({
  method: z.literal("connection_string"),
  connectionString: z.string().min(1),
});

export const DbCredentialsSchema = z.discriminatedUnion("method", [
  DbCredentialsUsernamePasswordSchema,
  DbCredentialsConnectionStringSchema,
]);

export type DbCredentials = z.infer<typeof DbCredentialsSchema>;

// ── Permission model ────────────────────────────────────────────────

export const DbPermissionRuleSchema = z.object({
  schemaName: z.string().min(1),
  tables: z
    .array(z.string().min(1))
    .default([])
    .describe("Empty array = all tables in schema allowed"),
});

export type DbPermissionRule = z.infer<typeof DbPermissionRuleSchema>;

export const DbPermissionsSchema = z.object({
  allowedSchemas: z
    .array(DbPermissionRuleSchema)
    .default([])
    .describe("Empty array = no schema access. Each entry whitelists a schema (and optionally specific tables)"),
  allowWrites: z.boolean().default(false),
});

export type DbPermissions = z.infer<typeof DbPermissionsSchema>;

// ── Connection config (returned by API) ─────────────────────────────

export const DatabaseConnectionConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  dialect: DatabaseDialectSchema,
  permissions: DbPermissionsSchema,
  status: ConnectionStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DatabaseConnectionConfig = z.infer<typeof DatabaseConnectionConfigSchema>;

// ── Create/Update input ─────────────────────────────────────────────

export const CreateDatabaseConnectionInputSchema = z.object({
  name: z.string().min(1).max(100),
  dialect: DatabaseDialectSchema,
  permissions: DbPermissionsSchema.optional(),
});

export type CreateDatabaseConnectionInput = z.infer<typeof CreateDatabaseConnectionInputSchema>;

export const UpdateDatabaseConnectionInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: DbPermissionsSchema.optional(),
});

export type UpdateDatabaseConnectionInput = z.infer<typeof UpdateDatabaseConnectionInputSchema>;

// ── Query activity (for insights) ───────────────────────────────────

export const DB_QUERY_TOOL_NAMES = [
  "db_list_schemas",
  "db_list_tables",
  "db_describe_table",
  "db_query",
] as const;

export type DbQueryToolName = (typeof DB_QUERY_TOOL_NAMES)[number];
