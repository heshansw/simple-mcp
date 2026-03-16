import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import type { DrizzleDB } from "./client.js";

export function runMigrations(db: DrizzleDB): void {
  try {
    migrate(db, { migrationsFolder: "src/backend/db/migrations" });
  } catch (error) {
    // Handle first-run gracefully when no migrations folder exists
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      // No migrations folder yet - this is acceptable on first run
      return;
    }
    throw error;
  }
}
