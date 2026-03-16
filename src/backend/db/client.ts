import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { copyFileSync } from "node:fs";

export type DrizzleDB = BetterSQLite3Database<Record<string, never>>;

export async function createDatabase(dbPath: string): Promise<DrizzleDB> {
  const directory = dirname(dbPath);
  await mkdir(directory, { recursive: true });

  const sqlite = new Database(dbPath);

  // Enable WAL mode for concurrent read performance
  sqlite.pragma("journal_mode = WAL");

  // Return drizzle-wrapped database
  return drizzle(sqlite);
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
