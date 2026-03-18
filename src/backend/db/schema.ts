import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const connectionsTable = sqliteTable("connections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  integrationType: text("integration_type").notNull(),
  baseUrl: text("base_url").notNull(),
  authMethod: text("auth_method").notNull(),
  status: text("status").default("disconnected").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const credentialsTable = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id")
    .notNull()
    .references(() => connectionsTable.id),
  encryptedData: text("encrypted_data").notNull(),
  iv: text("iv").notNull(),
  algorithm: text("algorithm").default("aes-256-cbc").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const agentConfigsTable = sqliteTable("agent_configs", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").unique().notNull(),
  enabled: integer("enabled").default(0).notNull(),
  parameterOverrides: text("parameter_overrides").default("{}").notNull(),
  linkedConnectionIds: text("linked_connection_ids").default("[]").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const serverSettingsTable = sqliteTable("server_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const syncMetadataTable = sqliteTable("sync_metadata", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id")
    .notNull()
    .references(() => connectionsTable.id),
  metadataType: text("metadata_type").notNull(),
  data: text("data").notNull(),
  lastSyncAt: text("last_sync_at").notNull(),
});

export const auditLogTable = sqliteTable("audit_log", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  details: text("details").notNull(),
  createdAt: text("created_at").notNull(),
});

export const reviewsTable = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  prNumber: integer("pr_number").notNull(),
  prTitle: text("pr_title").notNull().default(""),
  verdict: text("verdict").notNull(), // APPROVE | REQUEST_CHANGES | COMMENT
  inlineCommentCount: integer("inline_comment_count").notNull().default(0),
  reviewBody: text("review_body").notNull().default(""),
  githubReviewId: integer("github_review_id"),
  githubReviewUrl: text("github_review_url"),
  inputTokensEstimate: integer("input_tokens_estimate"),
  outputTokensEstimate: integer("output_tokens_estimate"),
  createdAt: text("created_at").notNull(),
});
