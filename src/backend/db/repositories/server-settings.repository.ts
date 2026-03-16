import { eq } from "drizzle-orm";
import { serverSettingsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type ServerSetting = typeof serverSettingsTable.$inferSelect;
export type NewServerSetting = typeof serverSettingsTable.$inferInsert;

export interface ServerSettingsRepository {
  get(key: string): string | undefined;
  set(key: string, value: string): ServerSetting;
  upsert(key: string, value: string): ServerSetting;
  findAll(): ServerSetting[];
  getAll(): Record<string, string>;
}

export function createServerSettingsRepository(
  db: DrizzleDB
): ServerSettingsRepository {
  return {
    get(key: string): string | undefined {
      const setting = db
        .select()
        .from(serverSettingsTable)
        .where(eq(serverSettingsTable.key, key))
        .get();

      return setting?.value;
    },

    set(key: string, value: string): ServerSetting {
      const now = new Date().toISOString();

      const existing = db
        .select()
        .from(serverSettingsTable)
        .where(eq(serverSettingsTable.key, key))
        .get();

      if (existing) {
        db.update(serverSettingsTable)
          .set({
            value,
            updatedAt: now,
          })
          .where(eq(serverSettingsTable.key, key))
          .run();

        const updated = db
          .select()
          .from(serverSettingsTable)
          .where(eq(serverSettingsTable.key, key))
          .get();

        if (!updated) {
          throw new Error(`Failed to retrieve updated setting for key ${key}`);
        }

        return updated;
      }

      const newSetting: NewServerSetting = {
        key,
        value,
        updatedAt: now,
      };

      db.insert(serverSettingsTable).values(newSetting).run();

      const created = db
        .select()
        .from(serverSettingsTable)
        .where(eq(serverSettingsTable.key, key))
        .get();

      if (!created) {
        throw new Error(`Failed to retrieve created setting for key ${key}`);
      }

      return created;
    },

    upsert(key: string, value: string): ServerSetting {
      return this.set(key, value);
    },

    findAll(): ServerSetting[] {
      return db.select().from(serverSettingsTable).all();
    },

    getAll(): Record<string, string> {
      const settings = db.select().from(serverSettingsTable).all();

      const result: Record<string, string> = {};
      for (const setting of settings) {
        result[setting.key] = setting.value;
      }

      return result;
    },
  };
}
