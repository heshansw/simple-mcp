import type { Logger } from "pino";
import type { GoogleMeetServiceResult, Participant } from "../services/google-meet.service.js";
import type { MeetTranscriptsRepository, FtsEntry } from "../db/repositories/meet-transcripts.repository.js";
import type { EncryptionService } from "../services/encryption.service.js";
import type { ServerSettingsRepository } from "../db/repositories/server-settings.repository.js";

const LAST_SYNC_KEY = "google-meet.last-sync-at";
const DEFAULT_LOOKBACK_HOURS = 48; // First sync looks back 48 hours

export interface TranscriptSyncDependencies {
  readonly logger: Logger;
  readonly googleMeetService: GoogleMeetServiceResult;
  readonly meetTranscriptsRepo: MeetTranscriptsRepository;
  readonly serverSettingsRepo: ServerSettingsRepository;
  readonly encryptionService: EncryptionService;
  readonly getConnectionId: () => Promise<string | null>;
}

export function createTranscriptSyncTask(
  deps: TranscriptSyncDependencies
): () => Promise<void> {
  return async (): Promise<void> => {
    const { logger, googleMeetService, meetTranscriptsRepo, serverSettingsRepo, encryptionService } = deps;

    const connectionId = await deps.getConnectionId();
    if (!connectionId) {
      logger.debug("Transcript sync skipped — no Google connection found");
      return;
    }

    // Determine sync window
    const lastSyncRaw = await serverSettingsRepo.get(LAST_SYNC_KEY);
    const lastSyncAt = lastSyncRaw
      ? lastSyncRaw
      : new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

    logger.info({ lastSyncAt }, "Starting transcript sync");

    let newTranscripts = 0;
    let totalEntries = 0;
    let errorCount = 0;

    try {
      // List conference records since last sync
      const filter = `end_time>${lastSyncAt}`;
      const recordsResult = await googleMeetService.listConferenceRecords({
        filter,
        pageSize: 50,
      });

      if (recordsResult._tag === "Err") {
        logger.error({ error: recordsResult.error }, "Failed to list conference records for sync");
        return;
      }

      const records = recordsResult.value.records;
      logger.info({ recordCount: records.length }, "Conference records found for sync");

      for (const record of records) {
        try {
          // Skip if already synced
          const existing = await meetTranscriptsRepo.findByConferenceRecordName(record.name);
          if (existing) {
            logger.debug({ name: record.name }, "Transcript already synced, skipping");
            continue;
          }

          // List transcripts for this record
          const transcriptsResult = await googleMeetService.listTranscripts(record.name);
          if (transcriptsResult._tag === "Err") {
            logger.warn({ name: record.name, error: transcriptsResult.error }, "Failed to list transcripts");
            errorCount++;
            continue;
          }

          if (transcriptsResult.value.length === 0) {
            logger.debug({ name: record.name }, "No transcripts for this meeting");
            continue;
          }

          // Fetch all entries from all transcripts
          const allEntries: Array<{ participant: string; text: string; languageCode: string; startOffset: string; endOffset: string }> = [];
          for (const transcript of transcriptsResult.value) {
            const entriesResult = await googleMeetService.getTranscriptEntries(transcript.name);
            if (entriesResult._tag === "Err") {
              logger.warn({ transcript: transcript.name, error: entriesResult.error }, "Failed to fetch transcript entries");
              errorCount++;
              continue;
            }
            allEntries.push(...entriesResult.value);
          }

          if (allEntries.length === 0) continue;

          // Resolve participant names
          const participantsResult = await googleMeetService.listParticipants(record.name);
          const participantMap = new Map<string, string>();
          if (participantsResult._tag === "Ok") {
            for (const p of participantsResult.value) {
              const displayName =
                p.signedinUser?.displayName ??
                p.anonymousUser?.displayName ??
                p.phoneUser?.displayName ??
                "Unknown";
              participantMap.set(p.name, displayName);
            }
          }

          const participantNames = [...new Set(participantMap.values())];

          // Encrypt transcript content
          const contentJson = JSON.stringify({
            entries: allEntries,
            participants: participantsResult._tag === "Ok" ? participantsResult.value : [],
          });
          const { encryptedData, iv } = encryptionService.encrypt(contentJson);

          // Store in database
          const created = await meetTranscriptsRepo.create({
            connectionId,
            conferenceRecordName: record.name,
            meetingStartTime: record.startTime,
            meetingEndTime: record.endTime,
            spaceName: record.space,
            participantNames: JSON.stringify(participantNames),
            entryCount: allEntries.length,
            encryptedContent: encryptedData,
            iv,
            syncedAt: new Date().toISOString(),
          });

          // Index in FTS5
          const ftsEntries: FtsEntry[] = allEntries.map((entry) => ({
            transcriptId: created.id,
            participantName: participantMap.get(entry.participant) ?? "Unknown",
            textContent: entry.text,
          }));
          await meetTranscriptsRepo.insertFtsEntries(ftsEntries);

          newTranscripts++;
          totalEntries += allEntries.length;

          logger.info(
            { name: record.name, entries: allEntries.length, participants: participantNames.length },
            "Transcript synced and indexed"
          );
        } catch (error) {
          logger.error({ name: record.name, error }, "Failed to sync individual transcript");
          errorCount++;
        }
      }

      // Update last sync timestamp
      const newSyncAt = new Date().toISOString();
      await serverSettingsRepo.set(LAST_SYNC_KEY, newSyncAt);

      logger.info(
        { newTranscripts, totalEntries, errorCount, lastSyncAt: newSyncAt },
        "Transcript sync completed"
      );
    } catch (error) {
      logger.error({ error }, "Transcript sync failed with unexpected error");
    }
  };
}
