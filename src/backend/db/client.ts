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
  `);
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
