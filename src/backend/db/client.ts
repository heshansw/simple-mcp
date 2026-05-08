import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { copyFileSync } from "node:fs";

export type DrizzleDB = ReturnType<typeof drizzle>;

export async function createDatabase(dbPath: string): Promise<DrizzleDB> {
  const directory = dirname(dbPath);
  await mkdir(directory, { recursive: true });

  const client = createClient({
    url: `file:${dbPath}`,
  });

  const db = drizzle(client);

  // Create tables (IF NOT EXISTS is safe to run every time)
  await createTables(client);

  return db;
}

async function createTables(
  client: ReturnType<typeof createClient>
): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      integration_type TEXT NOT NULL,
      base_url TEXT NOT NULL,
      auth_method TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'disconnected',
      database_dialect TEXT,
      allow_writes INTEGER NOT NULL DEFAULT 0,
      db_permissions TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS credentials (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id),
      encrypted_data TEXT NOT NULL,
      iv TEXT NOT NULL,
      algorithm TEXT NOT NULL DEFAULT 'aes-256-cbc',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_configs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 0,
      parameter_overrides TEXT NOT NULL DEFAULT '{}',
      linked_connection_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS server_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sync_metadata (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id),
      metadata_type TEXT NOT NULL,
      data TEXT NOT NULL,
      last_sync_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS folder_access (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      absolute_path TEXT NOT NULL UNIQUE,
      allowed_extensions TEXT NOT NULL DEFAULT '[]',
      max_file_size_kb INTEGER NOT NULL DEFAULT 512,
      recursive INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repo_workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      folder_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oauth_nonces (
      id TEXT PRIMARY KEY,
      nonce TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS confluence_activity (
      id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      space_key TEXT,
      page_id TEXT,
      cql TEXT,
      result_count INTEGER NOT NULL DEFAULT 0,
      content_size_bytes INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error_tag TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS db_query_activity (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      dialect TEXT NOT NULL,
      schema_name TEXT,
      table_name TEXT,
      sql_query TEXT,
      row_count INTEGER NOT NULL DEFAULT 0,
      result_size_bytes INTEGER NOT NULL DEFAULT 0,
      input_tokens_estimate INTEGER NOT NULL DEFAULT 0,
      output_tokens_estimate INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      error_tag TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planning',
      result TEXT,
      config TEXT NOT NULL DEFAULT '{}',
      iteration_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      input_tokens_used INTEGER NOT NULL DEFAULT 0,
      output_tokens_used INTEGER NOT NULL DEFAULT 0,
      parent_run_id TEXT,
      error_message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      description TEXT NOT NULL,
      depends_on TEXT NOT NULL DEFAULT '[]',
      required_tools TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_run_steps (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      step_index INTEGER NOT NULL DEFAULT 0,
      step_type TEXT NOT NULL,
      tool_name TEXT,
      tool_args TEXT,
      tool_result TEXT,
      tool_is_error INTEGER,
      delegate_target_agent_id TEXT,
      delegate_child_run_id TEXT,
      reasoning TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS repo_review_configs (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      ai_tool TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      requires_explicit_selection INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS repo_review_configs_owner_repo_tool_unique
      ON repo_review_configs(owner, repo, ai_tool);
    CREATE TABLE IF NOT EXISTS review_sessions (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS review_session_drafts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES review_sessions(id),
      agent_id TEXT NOT NULL,
      ai_tool TEXT NOT NULL,
      run_id TEXT,
      model TEXT,
      verdict TEXT NOT NULL,
      body TEXT NOT NULL,
      comments_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_title TEXT NOT NULL DEFAULT '',
      pr_author TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'in_progress',
      verdict TEXT NOT NULL DEFAULT '',
      inline_comment_count INTEGER NOT NULL DEFAULT 0,
      review_body TEXT NOT NULL DEFAULT '',
      files_changed INTEGER NOT NULL DEFAULT 0,
      additions INTEGER NOT NULL DEFAULT 0,
      deletions INTEGER NOT NULL DEFAULT 0,
      github_review_id INTEGER,
      github_review_url TEXT,
      input_tokens_estimate INTEGER,
      output_tokens_estimate INTEGER,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meet_transcripts (
      id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL REFERENCES connections(id),
      conference_record_name TEXT NOT NULL UNIQUE,
      meeting_title TEXT,
      meeting_start_time TEXT NOT NULL,
      meeting_end_time TEXT NOT NULL,
      space_name TEXT,
      participant_names TEXT NOT NULL DEFAULT '[]',
      entry_count INTEGER NOT NULL DEFAULT 0,
      encrypted_content TEXT NOT NULL,
      iv TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audio_transcripts (
      id TEXT PRIMARY KEY,
      meeting_title TEXT,
      meeting_url TEXT,
      source TEXT NOT NULL DEFAULT 'chrome-extension',
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL DEFAULT 0,
      language TEXT NOT NULL DEFAULT 'en',
      whisper_model TEXT NOT NULL,
      segment_count INTEGER NOT NULL DEFAULT 0,
      encrypted_content TEXT NOT NULL,
      iv TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meeting_analyses (
      id TEXT PRIMARY KEY,
      transcript_id TEXT NOT NULL REFERENCES audio_transcripts(id),
      analysis_type TEXT NOT NULL,
      title TEXT NOT NULL,
      encrypted_content TEXT NOT NULL,
      iv TEXT NOT NULL,
      model TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_health_snapshots (
      id TEXT PRIMARY KEY,
      directory_path TEXT NOT NULL,
      workspace_id TEXT,
      label TEXT,
      overall_score REAL NOT NULL,
      grade TEXT NOT NULL,
      file_count INTEGER NOT NULL DEFAULT 0,
      total_loc INTEGER NOT NULL DEFAULT 0,
      total_functions INTEGER NOT NULL DEFAULT 0,
      avg_cyclomatic REAL NOT NULL DEFAULT 0,
      avg_cognitive REAL NOT NULL DEFAULT 0,
      duplication_pct REAL NOT NULL DEFAULT 0,
      type_coverage_pct REAL,
      config_json TEXT NOT NULL DEFAULT '{}',
      git_ref TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_health_file_metrics (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL REFERENCES code_health_snapshots(id),
      file_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      language TEXT NOT NULL,
      score REAL NOT NULL,
      grade TEXT NOT NULL,
      loc INTEGER NOT NULL DEFAULT 0,
      sloc_logical INTEGER NOT NULL DEFAULT 0,
      function_count INTEGER NOT NULL DEFAULT 0,
      avg_cyclomatic REAL NOT NULL DEFAULT 0,
      max_cyclomatic REAL NOT NULL DEFAULT 0,
      avg_cognitive REAL NOT NULL DEFAULT 0,
      max_cognitive REAL NOT NULL DEFAULT 0,
      maintainability_index REAL NOT NULL DEFAULT 0,
      duplication_lines INTEGER NOT NULL DEFAULT 0,
      type_coverage_pct REAL,
      any_count INTEGER NOT NULL DEFAULT 0,
      nesting_depth_max INTEGER NOT NULL DEFAULT 0,
      issues_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_health_function_metrics (
      id TEXT PRIMARY KEY,
      file_metric_id TEXT NOT NULL REFERENCES code_health_file_metrics(id),
      function_name TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      loc INTEGER NOT NULL DEFAULT 0,
      parameter_count INTEGER NOT NULL DEFAULT 0,
      cyclomatic INTEGER NOT NULL DEFAULT 0,
      cognitive INTEGER NOT NULL DEFAULT 0,
      halstead_effort REAL NOT NULL DEFAULT 0,
      halstead_difficulty REAL NOT NULL DEFAULT 0,
      halstead_volume REAL NOT NULL DEFAULT 0,
      nesting_depth INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_health_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      file_path TEXT,
      before_score REAL,
      after_score REAL,
      issues_found INTEGER NOT NULL DEFAULT 0,
      issues_resolved INTEGER NOT NULL DEFAULT 0,
      iterations INTEGER NOT NULL DEFAULT 0,
      trigger TEXT NOT NULL DEFAULT 'manual',
      context_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_health_sessions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT,
      directory_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      files_changed TEXT NOT NULL DEFAULT '[]',
      initial_scores_json TEXT NOT NULL DEFAULT '{}',
      final_scores_json TEXT NOT NULL DEFAULT '{}',
      total_iterations INTEGER NOT NULL DEFAULT 0,
      target_score REAL NOT NULL DEFAULT 10,
      achieved_target INTEGER NOT NULL DEFAULT 0,
      max_iterations INTEGER NOT NULL DEFAULT 5,
      trigger TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_health_background_jobs (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      workspace_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      score REAL,
      grade TEXT,
      issue_count INTEGER NOT NULL DEFAULT 0,
      issues_json TEXT NOT NULL DEFAULT '[]',
      trigger_tool TEXT NOT NULL,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Create FTS5 virtual tables (separate statements — not supported in executeMultiple)
  try {
    await client.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS meet_transcripts_fts USING fts5(
        transcript_id UNINDEXED,
        participant_name,
        text_content,
        content='',
        tokenize='porter unicode61'
      )
    `);
  } catch {
    // FTS5 may not be available in all SQLite builds — degrade gracefully
  }

  try {
    await client.execute(`
      CREATE VIRTUAL TABLE IF NOT EXISTS audio_transcripts_fts USING fts5(
        transcript_id UNINDEXED,
        text_content,
        content='',
        tokenize='porter unicode61'
      )
    `);
  } catch {
    // FTS5 not available — degrade gracefully
  }

  // Additive migrations — ALTER TABLE is idempotent-safe with try/catch per column
  const migrations = [
    "ALTER TABLE connections ADD COLUMN database_dialect TEXT",
    "ALTER TABLE connections ADD COLUMN allow_writes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE connections ADD COLUMN db_permissions TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE review_session_drafts ADD COLUMN model TEXT",
    // Rename google-calendar → google for unified Google connection
    "UPDATE connections SET integration_type = 'google' WHERE integration_type = 'google-calendar'",
    // Add attendees column for speaker diarization
    "ALTER TABLE audio_transcripts ADD COLUMN attendees TEXT",
    // Add issues_json to background jobs for per-file issue tracking
    "ALTER TABLE code_health_background_jobs ADD COLUMN issues_json TEXT NOT NULL DEFAULT '[]'",
  ];

  for (const sql of migrations) {
    try {
      await client.execute(sql);
    } catch {
      // Column already exists — expected for idempotent migrations
    }
  }
}

export function backupDatabase(dbPath: string): void {
  try {
    const backupPath = `${dbPath}.bak`;
    copyFileSync(dbPath, backupPath);
  } catch (error) {
    // Fail silently if backup not possible (e.g., db doesn't exist yet)
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}
