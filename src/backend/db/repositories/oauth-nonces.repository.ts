import { eq, lt } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { oauthNoncesTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type OAuthNonce = typeof oauthNoncesTable.$inferSelect;

export interface OAuthNoncesRepository {
  create(nonce: string, provider: string, ttlMs: number): Promise<OAuthNonce>;
  findByNonce(nonce: string): Promise<OAuthNonce | undefined>;
  deleteByNonce(nonce: string): Promise<boolean>;
  deleteExpired(): Promise<void>;
}

export function createOAuthNoncesRepository(
  db: DrizzleDB
): OAuthNoncesRepository {
  return {
    async create(
      nonce: string,
      provider: string,
      ttlMs: number
    ): Promise<OAuthNonce> {
      const now = new Date();
      const id = randomUUID();
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

      const record = {
        id,
        nonce,
        provider,
        expiresAt,
        createdAt: now.toISOString(),
      };

      await db.insert(oauthNoncesTable).values(record);

      const results = await db
        .select()
        .from(oauthNoncesTable)
        .where(eq(oauthNoncesTable.id, id));

      const created = results[0];
      if (!created) {
        throw new Error(`Failed to retrieve created OAuth nonce with id ${id}`);
      }

      return created;
    },

    async findByNonce(nonce: string): Promise<OAuthNonce | undefined> {
      const results = await db
        .select()
        .from(oauthNoncesTable)
        .where(eq(oauthNoncesTable.nonce, nonce));

      const found = results[0];
      if (!found) return undefined;

      // Check expiry
      if (new Date(found.expiresAt) < new Date()) {
        await db
          .delete(oauthNoncesTable)
          .where(eq(oauthNoncesTable.nonce, nonce));
        return undefined;
      }

      return found;
    },

    async deleteByNonce(nonce: string): Promise<boolean> {
      await db
        .delete(oauthNoncesTable)
        .where(eq(oauthNoncesTable.nonce, nonce));
      return true;
    },

    async deleteExpired(): Promise<void> {
      const now = new Date().toISOString();
      await db
        .delete(oauthNoncesTable)
        .where(lt(oauthNoncesTable.expiresAt, now));
    },
  };
}
