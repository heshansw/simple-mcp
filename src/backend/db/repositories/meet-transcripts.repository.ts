import { eq, desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { meetTranscriptsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type MeetTranscript = typeof meetTranscriptsTable.$inferSelect;
export type NewMeetTranscript = typeof meetTranscriptsTable.$inferInsert;

export type MeetTranscriptSearchResult = {
  transcriptId: string;
  participantName: string;
  snippet: string;
  meetingStartTime: string;
};

export type FtsEntry = {
  transcriptId: string;
  participantName: string;
  textContent: string;
};

export interface MeetTranscriptsRepository {
  findById(id: string): Promise<MeetTranscript | undefined>;
  findByConferenceRecordName(name: string): Promise<MeetTranscript | undefined>;
  findRecent(limit: number): Promise<MeetTranscript[]>;
  create(
    data: Omit<NewMeetTranscript, "id" | "createdAt">
  ): Promise<MeetTranscript>;
  searchFts(query: string, limit: number): Promise<MeetTranscriptSearchResult[]>;
  insertFtsEntries(entries: FtsEntry[]): Promise<void>;
  deleteFtsEntries(transcriptId: string): Promise<void>;
  deleteByConnectionId(connectionId: string): Promise<boolean>;
}

export function createMeetTranscriptsRepository(
  db: DrizzleDB
): MeetTranscriptsRepository {
  return {
    async findById(id: string): Promise<MeetTranscript | undefined> {
      const results = await db
        .select()
        .from(meetTranscriptsTable)
        .where(eq(meetTranscriptsTable.id, id));
      return results[0];
    },

    async findByConferenceRecordName(name: string): Promise<MeetTranscript | undefined> {
      const results = await db
        .select()
        .from(meetTranscriptsTable)
        .where(eq(meetTranscriptsTable.conferenceRecordName, name));
      return results[0];
    },

    async findRecent(limit: number): Promise<MeetTranscript[]> {
      return await db
        .select()
        .from(meetTranscriptsTable)
        .orderBy(desc(meetTranscriptsTable.meetingStartTime))
        .limit(limit);
    },

    async create(
      data: Omit<NewMeetTranscript, "id" | "createdAt">
    ): Promise<MeetTranscript> {
      const now = new Date().toISOString();
      const id = randomUUID();

      const record: NewMeetTranscript = {
        ...data,
        id,
        createdAt: now,
      };

      await db.insert(meetTranscriptsTable).values(record);

      const results = await db
        .select()
        .from(meetTranscriptsTable)
        .where(eq(meetTranscriptsTable.id, id));

      const created = results[0];
      if (!created) {
        throw new Error(`Failed to retrieve created meet transcript with id ${id}`);
      }

      return created;
    },

    async searchFts(query: string, limit: number): Promise<MeetTranscriptSearchResult[]> {
      try {
        const results = await db.all<{
          transcript_id: string;
          participant_name: string;
          snippet: string;
        }>(sql`
          SELECT
            transcript_id,
            participant_name,
            snippet(meet_transcripts_fts, 2, '<b>', '</b>', '...', 32) as snippet
          FROM meet_transcripts_fts
          WHERE meet_transcripts_fts MATCH ${query}
          ORDER BY rank
          LIMIT ${limit}
        `);

        // Enrich with meeting start time from the main table
        const enriched: MeetTranscriptSearchResult[] = [];
        for (const row of results) {
          const transcript = await this.findById(row.transcript_id);
          enriched.push({
            transcriptId: row.transcript_id,
            participantName: row.participant_name,
            snippet: row.snippet,
            meetingStartTime: transcript?.meetingStartTime ?? "",
          });
        }

        return enriched;
      } catch {
        // FTS5 not available — return empty results
        return [];
      }
    },

    async insertFtsEntries(entries: FtsEntry[]): Promise<void> {
      try {
        for (const entry of entries) {
          await db.run(sql`
            INSERT INTO meet_transcripts_fts(transcript_id, participant_name, text_content)
            VALUES (${entry.transcriptId}, ${entry.participantName}, ${entry.textContent})
          `);
        }
      } catch {
        // FTS5 not available — silently skip indexing
      }
    },

    async deleteFtsEntries(transcriptId: string): Promise<void> {
      try {
        await db.run(sql`
          DELETE FROM meet_transcripts_fts WHERE transcript_id = ${transcriptId}
        `);
      } catch {
        // FTS5 not available
      }
    },

    async deleteByConnectionId(connectionId: string): Promise<boolean> {
      const result = await db
        .delete(meetTranscriptsTable)
        .where(eq(meetTranscriptsTable.connectionId, connectionId));
      return (result.rowsAffected ?? 0) > 0;
    },
  };
}
