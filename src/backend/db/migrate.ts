import { migrate } from "drizzle-orm/libsql/migrator";
import type { DrizzleDB } from "./client.js";

export async function runMigrations(db: DrizzleDB): Promise<void> {
  try {
    await migrate(db, { migrationsFolder: "src/backend/db/migrations" });
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
