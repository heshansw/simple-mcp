import { eq, desc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { audioTranscriptsTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type AudioTranscript = typeof audioTranscriptsTable.$inferSelect;
export type NewAudioTranscript = typeof audioTranscriptsTable.$inferInsert;

export type AudioTranscriptSearchResult = {
  transcriptId: string;
  snippet: string;
  meetingTitle: string | null;
  startTime: string;
};

export type FtsEntry = {
  transcriptId: string;
  textContent: string;
};

export interface AudioTranscriptsRepository {
  findById(id: string): Promise<AudioTranscript | undefined>;
  findRecent(limit: number): Promise<AudioTranscript[]>;
  create(data: Omit<NewAudioTranscript, "id" | "createdAt">): Promise<AudioTranscript>;
  searchFts(query: string, limit: number): Promise<AudioTranscriptSearchResult[]>;
  insertFtsEntries(entries: FtsEntry[]): Promise<void>;
  count(): Promise<number>;
  totalDurationSeconds(): Promise<number>;
}

export function createAudioTranscriptsRepository(
  db: DrizzleDB
): AudioTranscriptsRepository {
  return {
    async findById(id: string): Promise<AudioTranscript | undefined> {
      const results = await db
        .select()
        .from(audioTranscriptsTable)
        .where(eq(audioTranscriptsTable.id, id));
      return results[0];
    },

    async findRecent(limit: number): Promise<AudioTranscript[]> {
      return await db
        .select()
        .from(audioTranscriptsTable)
        .orderBy(desc(audioTranscriptsTable.startTime))
        .limit(limit);
    },

    async create(
      data: Omit<NewAudioTranscript, "id" | "createdAt">
    ): Promise<AudioTranscript> {
      const now = new Date().toISOString();
      const id = randomUUID();

      const record: NewAudioTranscript = {
        ...data,
        id,
        createdAt: now,
      };

      await db.insert(audioTranscriptsTable).values(record);

      const results = await db
        .select()
        .from(audioTranscriptsTable)
        .where(eq(audioTranscriptsTable.id, id));

      const created = results[0];
      if (!created) {
        throw new Error(`Failed to retrieve created audio transcript with id ${id}`);
      }

      return created;
    },

    async searchFts(query: string, limit: number): Promise<AudioTranscriptSearchResult[]> {
      try {
        const results = await db.all<{
          transcript_id: string;
          snippet: string;
        }>(sql`
          SELECT
            transcript_id,
            snippet(audio_transcripts_fts, 1, '<b>', '</b>', '...', 32) as snippet
          FROM audio_transcripts_fts
          WHERE audio_transcripts_fts MATCH ${query}
          ORDER BY rank
          LIMIT ${limit}
        `);

        const enriched: AudioTranscriptSearchResult[] = [];
        for (const row of results) {
          const transcript = await this.findById(row.transcript_id);
          enriched.push({
            transcriptId: row.transcript_id,
            snippet: row.snippet,
            meetingTitle: transcript?.meetingTitle ?? null,
            startTime: transcript?.startTime ?? "",
          });
        }

        return enriched;
      } catch {
        // FTS5 not available
        return [];
      }
    },

    async insertFtsEntries(entries: FtsEntry[]): Promise<void> {
      try {
        for (const entry of entries) {
          await db.run(sql`
            INSERT INTO audio_transcripts_fts(transcript_id, text_content)
            VALUES (${entry.transcriptId}, ${entry.textContent})
          `);
        }
      } catch {
        // FTS5 not available — silently skip
      }
    },

    async count(): Promise<number> {
      const result = await db.all<{ cnt: number }>(
        sql`SELECT COUNT(*) as cnt FROM audio_transcripts`
      );
      return result[0]?.cnt ?? 0;
    },

    async totalDurationSeconds(): Promise<number> {
      const result = await db.all<{ total: number }>(
        sql`SELECT COALESCE(SUM(duration_seconds), 0) as total FROM audio_transcripts`
      );
      return result[0]?.total ?? 0;
    },
  };
}
