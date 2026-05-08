import type { Logger } from "pino";
import { writeFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type Result,
  err,
  ok,
  validationError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";
import type { CommandExecutor } from "./command-executor.service.js";
import type { AudioCaptureServiceResult, ProcessedTranscript } from "./audio-capture.service.js";

// ── Types ────────────────────────────────────────────────────────────────

export type AudioSession = {
  id: string;
  meetingTitle: string;
  meetingUrl: string;
  startTime: string;
  attendees: string[];
  chunkCount: number;
  createdAt: number;
};

export type ProcessingJobStatus =
  | "concatenating"
  | "converting"
  | "transcribing"
  | "attributing"
  | "completed"
  | "failed";

export type ProcessingJob = {
  id: string;
  status: ProcessingJobStatus;
  progress: number; // 0-100
  meetingTitle: string;
  startedAt: string;
  completedAt?: string;
  result?: ProcessedTranscript;
  error?: string;
};

export type AudioSessionServiceDependencies = {
  logger: Logger;
  sessionsDir: string; // e.g. ~/.simple-mcp/audio/sessions/
  commandExecutor: CommandExecutor;
  audioCaptureService: AudioCaptureServiceResult;
};

// ── Service interface ────────────────────────────────────────────────────

export type AudioSessionServiceResult = {
  createSession(params: {
    meetingTitle?: string;
    meetingUrl?: string;
    startTime?: string;
    attendees?: string[];
  }): Promise<Result<AudioSession, DomainError>>;

  appendChunk(
    sessionId: string,
    chunkBuffer: Buffer,
    chunkIndex: number,
  ): Promise<Result<{ chunkIndex: number; sizeBytes: number }, DomainError>>;

  /** Starts processing in background, returns immediately with a job reference */
  finalizeSession(
    sessionId: string,
    endTime?: string,
  ): Promise<Result<{ jobId: string; status: ProcessingJobStatus }, DomainError>>;

  abortSession(sessionId: string): Promise<Result<void, DomainError>>;

  cleanupExpiredSessions(maxAgeMs?: number): Promise<void>;

  getJob(jobId: string): ProcessingJob | undefined;

  listJobs(): ProcessingJob[];
};

// ── Constants ────────────────────────────────────────────────────────────

const SESSION_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours
const JOB_RETENTION_MS = 60 * 60 * 1000; // Keep completed jobs for 1 hour
const SESSION_META_FILE = "session.json";

// ── Implementation ───────────────────────────────────────────────────────

export function createAudioSessionService(
  deps: AudioSessionServiceDependencies,
): AudioSessionServiceResult {
  const { logger, sessionsDir, commandExecutor, audioCaptureService } = deps;

  // In-memory job tracking
  const jobs = new Map<string, ProcessingJob>();

  function sessionDir(sessionId: string): string {
    return join(sessionsDir, sessionId);
  }

  async function readSessionMeta(sessionId: string): Promise<AudioSession | null> {
    try {
      const { readFile } = await import("node:fs/promises");
      const raw = await readFile(join(sessionDir(sessionId), SESSION_META_FILE), "utf-8");
      return JSON.parse(raw) as AudioSession;
    } catch {
      return null;
    }
  }

  async function writeSessionMeta(session: AudioSession): Promise<void> {
    await writeFile(
      join(sessionDir(session.id), SESSION_META_FILE),
      JSON.stringify(session, null, 2),
    );
  }

  function updateJob(jobId: string, update: Partial<ProcessingJob>): void {
    const job = jobs.get(jobId);
    if (job) {
      Object.assign(job, update);
    }
  }

  function cleanupOldJobs(): void {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (
        (job.status === "completed" || job.status === "failed") &&
        job.completedAt &&
        now - new Date(job.completedAt).getTime() > JOB_RETENTION_MS
      ) {
        jobs.delete(id);
      }
    }
  }

  // Run the actual processing pipeline in the background
  async function processInBackground(
    jobId: string,
    session: AudioSession,
    dir: string,
    chunkFiles: string[],
    endTime: string,
  ): Promise<void> {
    try {
      // Step 1: Concatenate chunks
      updateJob(jobId, { status: "concatenating", progress: 10 });

      const concatListPath = join(dir, "concat-list.txt");
      const concatContent = chunkFiles
        .map((f) => `file '${commandExecutor.mapPath(join(dir, f))}'`)
        .join("\n");
      await writeFile(concatListPath, concatContent);

      const outputPath = join(dir, "combined.webm");
      const concatResult = await commandExecutor.run("ffmpeg", [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", commandExecutor.mapPath(concatListPath),
        "-c", "copy",
        commandExecutor.mapPath(outputPath),
      ], 120_000);

      if (concatResult.exitCode !== 0) {
        updateJob(jobId, {
          status: "failed",
          error: `Chunk concatenation failed: ${concatResult.stderr.slice(0, 200)}`,
          completedAt: new Date().toISOString(),
        });
        return;
      }

      updateJob(jobId, { status: "converting", progress: 30 });

      // Step 2-4: Pass to audio capture service (it handles convert + transcribe + attribute)
      updateJob(jobId, { status: "transcribing", progress: 50 });

      const { readFile } = await import("node:fs/promises");
      const audioBuffer = await readFile(outputPath);

      const result = await audioCaptureService.processUpload({
        audioBuffer,
        mimeType: "audio/webm;codecs=opus",
        meetingTitle: session.meetingTitle,
        meetingUrl: session.meetingUrl,
        startTime: session.startTime,
        endTime,
        attendees: session.attendees,
      });

      if (result._tag === "Err") {
        const { domainErrorMessage } = await import("../../shared/result.js");
        updateJob(jobId, {
          status: "failed",
          error: domainErrorMessage(result.error),
          completedAt: new Date().toISOString(),
        });
        return;
      }

      // Success
      updateJob(jobId, {
        status: "completed",
        progress: 100,
        result: result.value,
        completedAt: new Date().toISOString(),
      });

      // Clean up session directory
      try {
        await rm(dir, { recursive: true, force: true });
        logger.info({ sessionId: jobId }, "Session directory cleaned up");
      } catch {
        logger.warn({ sessionId: jobId }, "Failed to clean up session directory");
      }

      logger.info(
        { jobId, transcriptId: result.value.id },
        "Background transcription completed",
      );
    } catch (error) {
      updateJob(jobId, {
        status: "failed",
        error: `Processing failed: ${error instanceof Error ? error.message : String(error)}`,
        completedAt: new Date().toISOString(),
      });
      logger.error({ jobId, error }, "Background transcription failed");
    }
  }

  return {
    async createSession(params) {
      const id = randomUUID();
      const dir = sessionDir(id);
      await mkdir(dir, { recursive: true });

      const session: AudioSession = {
        id,
        meetingTitle: params.meetingTitle || "Untitled Meeting",
        meetingUrl: params.meetingUrl || "",
        startTime: params.startTime || new Date().toISOString(),
        attendees: params.attendees || [],
        chunkCount: 0,
        createdAt: Date.now(),
      };

      await writeSessionMeta(session);

      logger.info({ sessionId: id }, "Audio session created");
      return ok(session);
    },

    async appendChunk(sessionId, chunkBuffer, chunkIndex) {
      const session = await readSessionMeta(sessionId);
      if (!session) {
        return err(validationError(`Session not found: ${sessionId}`));
      }

      const chunkPath = join(sessionDir(sessionId), `chunk-${String(chunkIndex).padStart(6, "0")}.webm`);
      await writeFile(chunkPath, chunkBuffer);

      session.chunkCount = Math.max(session.chunkCount, chunkIndex + 1);
      await writeSessionMeta(session);

      logger.debug(
        { sessionId, chunkIndex, sizeBytes: chunkBuffer.length },
        "Audio chunk appended",
      );

      return ok({ chunkIndex, sizeBytes: chunkBuffer.length });
    },

    async finalizeSession(sessionId, endTime) {
      const session = await readSessionMeta(sessionId);
      if (!session) {
        return err(validationError(`Session not found: ${sessionId}`));
      }

      const dir = sessionDir(sessionId);

      const files = await readdir(dir);
      const chunkFiles = files
        .filter((f) => f.startsWith("chunk-") && f.endsWith(".webm"))
        .sort();

      if (chunkFiles.length === 0) {
        return err(validationError("No audio chunks found for this session"));
      }

      // Create job and start processing in background
      const jobId = sessionId;
      const job: ProcessingJob = {
        id: jobId,
        status: "concatenating",
        progress: 5,
        meetingTitle: session.meetingTitle,
        startedAt: new Date().toISOString(),
      };
      jobs.set(jobId, job);

      // Clean up old jobs
      cleanupOldJobs();

      logger.info(
        { sessionId, chunkCount: chunkFiles.length, jobId },
        "Starting background transcription",
      );

      // Fire and forget — processing runs in background
      processInBackground(
        jobId,
        session,
        dir,
        chunkFiles,
        endTime || new Date().toISOString(),
      ).catch((error) => {
        logger.error({ jobId, error }, "Background processing crashed");
        updateJob(jobId, {
          status: "failed",
          error: "Processing crashed unexpectedly",
          completedAt: new Date().toISOString(),
        });
      });

      return ok({ jobId, status: job.status });
    },

    async abortSession(sessionId) {
      const dir = sessionDir(sessionId);
      try {
        await rm(dir, { recursive: true, force: true });
        jobs.delete(sessionId);
        logger.info({ sessionId }, "Audio session aborted and cleaned up");
        return ok(undefined);
      } catch (error) {
        return err(validationError(`Failed to abort session: ${String(error)}`));
      }
    },

    async cleanupExpiredSessions(maxAgeMs = SESSION_MAX_AGE_MS) {
      try {
        await mkdir(sessionsDir, { recursive: true });
        const entries = await readdir(sessionsDir);
        const now = Date.now();

        for (const entry of entries) {
          const entryPath = join(sessionsDir, entry);
          try {
            const stats = await stat(entryPath);
            if (stats.isDirectory() && now - stats.mtimeMs > maxAgeMs) {
              await rm(entryPath, { recursive: true, force: true });
              logger.info({ sessionId: entry }, "Expired audio session cleaned up");
            }
          } catch {
            // Skip entries we can't stat
          }
        }
      } catch {
        // Sessions dir doesn't exist yet — nothing to clean
      }
    },

    getJob(jobId) {
      return jobs.get(jobId);
    },

    listJobs() {
      return [...jobs.values()];
    },
  };
}
