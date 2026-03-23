import { eq } from "drizzle-orm";
import { serverSettingsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type ServerSetting = typeof serverSettingsTable.$inferSelect;
export type NewServerSetting = typeof serverSettingsTable.$inferInsert;

export interface ServerSettingsRepository {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<ServerSetting>;
  upsert(key: string, value: string): Promise<ServerSetting>;
  findAll(): Promise<ServerSetting[]>;
  getAll(): Promise<Record<string, string>>;
}

export function createServerSettingsRepository(
  db: DrizzleDB
): ServerSettingsRepository {
  return {
    async get(key: string): Promise<string | undefined> {
      const results = await db
        .select()
        .from(serverSettingsTable)
        .where(eq(serverSettingsTable.key, key));

      return results[0]?.value;
    },

    async set(key: string, value: string): Promise<ServerSetting> {
      const now = new Date().toISOString();

      const existingResults = await db
        .select()
        .from(serverSettingsTable)
        .where(eq(serverSettingsTable.key, key));

      const existing = existingResults[0];

      if (existing) {
        await db
          .update(serverSettingsTable)
          .set({
            value,
            updatedAt: now,
          })
          .where(eq(serverSettingsTable.key, key));

        const updatedResults = await db
          .select()
          .from(serverSettingsTable)
          .where(eq(serverSettingsTable.key, key));

        const updated = updatedResults[0];

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

      await db.insert(serverSettingsTable).values(newSetting);

      const createdResults = await db
        .select()
        .from(serverSettingsTable)
        .where(eq(serverSettingsTable.key, key));

      const created = createdResults[0];

      if (!created) {
        throw new Error(`Failed to retrieve created setting for key ${key}`);
      }

      return created;
    },

    async upsert(key: string, value: string): Promise<ServerSetting> {
      return this.set(key, value);
    },

    async findAll(): Promise<ServerSetting[]> {
      return await db.select().from(serverSettingsTable);
    },

    async getAll(): Promise<Record<string, string>> {
      const settings = await db.select().from(serverSettingsTable);

      const result: Record<string, string> = {};
      for (const setting of settings) {
        result[setting.key] = setting.value;
      }

      return result;
    },
  };
}
