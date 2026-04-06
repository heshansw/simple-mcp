import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const connectionsTable = sqliteTable("connections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  integrationType: text("integration_type").notNull(),
  baseUrl: text("base_url").notNull(),
  authMethod: text("auth_method").notNull(),
  status: text("status").default("disconnected").notNull(),
  databaseDialect: text("database_dialect"), // "mysql" | "postgres" — only when integrationType is mysql/postgres
  allowWrites: integer("allow_writes").default(0).notNull(), // 0 = read-only, 1 = allow INSERT/UPDATE/DELETE
  dbPermissions: text("db_permissions").default("{}").notNull(), // JSON: { allowedSchemas: [...], allowWrites: false }
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

export const folderAccessTable = sqliteTable("folder_access", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  absolutePath: text("absolute_path").notNull().unique(),
  allowedExtensions: text("allowed_extensions").notNull().default("[]"),
  maxFileSizeKb: integer("max_file_size_kb").notNull().default(512),
  recursive: integer("recursive").notNull().default(1),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const repoWorkspacesTable = sqliteTable("repo_workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  folderIds: text("folder_ids").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const oauthNoncesTable = sqliteTable("oauth_nonces", {
  id: text("id").primaryKey(),
  nonce: text("nonce").notNull().unique(),
  provider: text("provider").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});

export const confluenceActivityTable = sqliteTable("confluence_activity", {
  id: text("id").primaryKey(),
  toolName: text("tool_name").notNull(), // confluence_search_pages | confluence_get_page | confluence_list_spaces
  spaceKey: text("space_key"), // nullable — not always applicable
  pageId: text("page_id"), // nullable — only for get_page
  cql: text("cql"), // nullable — only for search
  resultCount: integer("result_count").notNull().default(0),
  contentSizeBytes: integer("content_size_bytes").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  success: integer("success").notNull().default(1), // 0 = error, 1 = success
  errorTag: text("error_tag"), // nullable
  createdAt: text("created_at").notNull(),
});

export const dbQueryActivityTable = sqliteTable("db_query_activity", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  toolName: text("tool_name").notNull(), // db_list_schemas | db_list_tables | db_describe_table | db_query
  dialect: text("dialect").notNull(), // mysql | postgres
  schemaName: text("schema_name"), // nullable
  tableName: text("table_name"), // nullable
  sqlQuery: text("sql_query"), // nullable — only for db_query
  rowCount: integer("row_count").notNull().default(0),
  resultSizeBytes: integer("result_size_bytes").notNull().default(0),
  inputTokensEstimate: integer("input_tokens_estimate").notNull().default(0),
  outputTokensEstimate: integer("output_tokens_estimate").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  success: integer("success").notNull().default(1), // 0 = error, 1 = success
  errorTag: text("error_tag"), // nullable
  createdAt: text("created_at").notNull(),
});

export const agentRunsTable = sqliteTable("agent_runs", {
  id: text("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("planning"), // planning | executing | completed | failed | cancelled
  result: text("result"), // JSON serialized AgentRunResult
  config: text("config").notNull().default("{}"), // JSON serialized AgentRunConfig
  iterationCount: integer("iteration_count").notNull().default(0),
  toolCallCount: integer("tool_call_count").notNull().default(0),
  inputTokensUsed: integer("input_tokens_used").notNull().default(0),
  outputTokensUsed: integer("output_tokens_used").notNull().default(0),
  parentRunId: text("parent_run_id"), // nullable, set for delegated runs
  errorMessage: text("error_message"), // nullable
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"), // nullable
  createdAt: text("created_at").notNull(),
});

export const agentTasksTable = sqliteTable("agent_tasks", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  description: text("description").notNull(),
  dependsOn: text("depends_on").notNull().default("[]"), // JSON array of task IDs
  requiredTools: text("required_tools").notNull().default("[]"), // JSON array of tool names
  status: text("status").notNull().default("pending"), // pending | in_progress | completed | failed | skipped
  result: text("result"), // nullable, JSON
  startedAt: text("started_at"), // nullable
  completedAt: text("completed_at"), // nullable
  createdAt: text("created_at").notNull(),
});

export const agentRunStepsTable = sqliteTable("agent_run_steps", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  stepIndex: integer("step_index").notNull().default(0),
  stepType: text("step_type").notNull(), // llm_call | tool_call | delegation | plan | error | guardrail
  toolName: text("tool_name"), // nullable
  toolArgs: text("tool_args"), // nullable, JSON
  toolResult: text("tool_result"), // nullable, truncated
  toolIsError: integer("tool_is_error"), // nullable, 0 or 1
  delegateTargetAgentId: text("delegate_target_agent_id"), // nullable
  delegateChildRunId: text("delegate_child_run_id"), // nullable
  reasoning: text("reasoning"), // nullable, for llm_call steps
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const reviewsTable = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  prNumber: integer("pr_number").notNull(),
  prTitle: text("pr_title").notNull().default(""),
  prAuthor: text("pr_author").notNull().default(""),
  status: text("status").notNull().default("in_progress"), // in_progress | completed
  verdict: text("verdict").notNull().default(""), // APPROVE | REQUEST_CHANGES | COMMENT (set on completion)
  inlineCommentCount: integer("inline_comment_count").notNull().default(0),
  reviewBody: text("review_body").notNull().default(""),
  filesChanged: integer("files_changed").notNull().default(0),
  additions: integer("additions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
  githubReviewId: integer("github_review_id"),
  githubReviewUrl: text("github_review_url"),
  inputTokensEstimate: integer("input_tokens_estimate"),
  outputTokensEstimate: integer("output_tokens_estimate"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
});
