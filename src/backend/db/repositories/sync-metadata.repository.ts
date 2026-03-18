import { eq, and } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { syncMetadataTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type SyncMetadata = typeof syncMetadataTable.$inferSelect;
export type NewSyncMetadata = typeof syncMetadataTable.$inferInsert;

export interface SyncMetadataRepository {
  findByConnectionId(connectionId: string): Promise<SyncMetadata[]>;
  upsert(
    connectionId: string,
    metadataType: string,
    data: string,
    lastSyncAt: string
  ): Promise<SyncMetadata>;
  deleteByConnectionId(connectionId: string): Promise<boolean>;
}

export function createSyncMetadataRepository(
  db: DrizzleDB
): SyncMetadataRepository {
  return {
    async findByConnectionId(connectionId: string): Promise<SyncMetadata[]> {
      return await db
        .select()
        .from(syncMetadataTable)
        .where(eq(syncMetadataTable.connectionId, connectionId));
    },

    async upsert(
      connectionId: string,
      metadataType: string,
      data: string,
      lastSyncAt: string
    ): Promise<SyncMetadata> {
      const existingResults = await db
        .select()
        .from(syncMetadataTable)
        .where(
          and(
            eq(syncMetadataTable.connectionId, connectionId),
            eq(syncMetadataTable.metadataType, metadataType)
          )
        );

      const existing = existingResults[0];

      if (existing) {
        await db
          .update(syncMetadataTable)
          .set({
            data,
            lastSyncAt,
          })
          .where(eq(syncMetadataTable.id, existing.id));

        const updatedResults = await db
          .select()
          .from(syncMetadataTable)
          .where(eq(syncMetadataTable.id, existing.id));

        const updated = updatedResults[0];

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

      await db.insert(syncMetadataTable).values(newMetadata);

      const createdResults = await db
        .select()
        .from(syncMetadataTable)
        .where(eq(syncMetadataTable.id, id));

      const created = createdResults[0];

      if (!created) {
        throw new Error(`Failed to retrieve created sync metadata with id ${id}`);
      }

      return created;
    },

    async deleteByConnectionId(connectionId: string): Promise<boolean> {
      await db
        .delete(syncMetadataTable)
        .where(eq(syncMetadataTable.connectionId, connectionId));

      return true;
    },
  };
}
