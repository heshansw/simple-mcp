import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { syncMetadataTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type SyncMetadata = typeof syncMetadataTable.$inferSelect;
export type NewSyncMetadata = typeof syncMetadataTable.$inferInsert;

export interface SyncMetadataRepository {
  findByConnectionId(connectionId: string): SyncMetadata[];
  upsert(
    connectionId: string,
    metadataType: string,
    data: string,
    lastSyncAt: string
  ): SyncMetadata;
  deleteByConnectionId(connectionId: string): boolean;
}

export function createSyncMetadataRepository(
  db: DrizzleDB
): SyncMetadataRepository {
  return {
    findByConnectionId(connectionId: string): SyncMetadata[] {
      return db
        .select()
        .from(syncMetadataTable)
        .where(eq(syncMetadataTable.connectionId, connectionId))
        .all();
    },

    upsert(
      connectionId: string,
      metadataType: string,
      data: string,
      lastSyncAt: string
    ): SyncMetadata {
      const existing = db
        .select()
        .from(syncMetadataTable)
        .where(
          and(
            eq(syncMetadataTable.connectionId, connectionId),
            eq(syncMetadataTable.metadataType, metadataType)
          )
        )
        .get();

      if (existing) {
        db.update(syncMetadataTable)
          .set({
            data,
            lastSyncAt,
          })
          .where(eq(syncMetadataTable.id, existing.id))
          .run();

        const updated = db
          .select()
          .from(syncMetadataTable)
          .where(eq(syncMetadataTable.id, existing.id))
          .get();

        if (!updated) {
          throw new Error(
            `Failed to retrieve updated sync metadata with id ${existing.id}`
          );
        }

        return updated;
      }

      const id = randomUUID();

      const newMetadata: NewSyncMetadata = {
        id,
        connectionId,
        metadataType,
        data,
        lastSyncAt,
      };

      db.insert(syncMetadataTable).values(newMetadata).run();

      const created = db
        .select()
        .from(syncMetadataTable)
        .where(eq(syncMetadataTable.id, id))
        .get();

      if (!created) {
        throw new Error(`Failed to retrieve created sync metadata with id ${id}`);
      }

      return created;
    },

    deleteByConnectionId(connectionId: string): boolean {
      const result = db
        .delete(syncMetadataTable)
        .where(eq(syncMetadataTable.connectionId, connectionId))
        .run();

      return result.changes > 0;
    },
  };
}
