import { eq, desc } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { meetingAnalysesTable } from "../schema.js";
import type { DrizzleDB } from "../client.js";

export type MeetingAnalysis = typeof meetingAnalysesTable.$inferSelect;
export type NewMeetingAnalysis = typeof meetingAnalysesTable.$inferInsert;

export interface MeetingAnalysesRepository {
  create(data: Omit<NewMeetingAnalysis, "id" | "createdAt">): Promise<MeetingAnalysis>;
  findById(id: string): Promise<MeetingAnalysis | undefined>;
  findByTranscriptId(transcriptId: string): Promise<MeetingAnalysis[]>;
  findRecent(limit: number): Promise<MeetingAnalysis[]>;
}

export function createMeetingAnalysesRepository(
  db: DrizzleDB
): MeetingAnalysesRepository {
  return {
    async create(
      data: Omit<NewMeetingAnalysis, "id" | "createdAt">
    ): Promise<MeetingAnalysis> {
      const now = new Date().toISOString();
      const id = randomUUID();

      const record: NewMeetingAnalysis = {
        ...data,
        id,
        createdAt: now,
      };

      await db.insert(meetingAnalysesTable).values(record);

      const results = await db
        .select()
        .from(meetingAnalysesTable)
        .where(eq(meetingAnalysesTable.id, id));

      const created = results[0];
      if (!created) {
        throw new Error(`Failed to retrieve created meeting analysis with id ${id}`);
      }

      return created;
    },

    async findById(id: string): Promise<MeetingAnalysis | undefined> {
      const results = await db
        .select()
        .from(meetingAnalysesTable)
        .where(eq(meetingAnalysesTable.id, id));
      return results[0];
    },

    async findByTranscriptId(transcriptId: string): Promise<MeetingAnalysis[]> {
      return await db
        .select()
        .from(meetingAnalysesTable)
        .where(eq(meetingAnalysesTable.transcriptId, transcriptId))
        .orderBy(desc(meetingAnalysesTable.createdAt));
    },

    async findRecent(limit: number): Promise<MeetingAnalysis[]> {
      return await db
        .select()
        .from(meetingAnalysesTable)
        .orderBy(desc(meetingAnalysesTable.createdAt))
        .limit(limit);
    },
  };
}
