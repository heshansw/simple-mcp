import type { Logger } from "pino";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  type Result,
  err,
  ok,
  integrationError,
  validationError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";
import type { CommandExecutor } from "./command-executor.service.js";
import type { WhisperTranscriptionServiceResult } from "./whisper-transcription.service.js";
import type { AudioTranscriptsRepository, FtsEntry } from "../db/repositories/audio-transcripts.repository.js";
import type { EncryptionService } from "./encryption.service.js";

// ── Types ────────────────────────────────────────────────────────────────

export type ProcessedTranscript = {
  id: string;
  meetingTitle: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  segmentCount: number;
  language: string;
  whisperModel: string;
  processingTimeMs: number;
};

export type AudioCaptureServiceDependencies = {
  logger: Logger;
  dataDir: string; // e.g. ~/.simple-mcp/audio/
  commandExecutor: CommandExecutor;
  whisperService: WhisperTranscriptionServiceResult;
  audioTranscriptsRepo: AudioTranscriptsRepository;
  encryptionService: EncryptionService;
};

// ── Service interface ────────────────────────────────────────────────────

export interface AudioCaptureServiceResult {
  processUpload(params: {
    audioBuffer: Buffer;
    mimeType: string;
    meetingTitle?: string;
    meetingUrl?: string;
    startTime: string;
    endTime: string;
  }): Promise<Result<ProcessedTranscript, DomainError>>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function convertToWav(
  executor: CommandExecutor,
  inputPath: string,
  outputPath: string
): Promise<Result<void, DomainError>> {
  const result = await executor.run("ffmpeg", [
    "-y",
    "-i", executor.mapPath(inputPath),
    "-ar", "16000",
    "-ac", "1",
    "-acodec", "pcm_s16le",
    executor.mapPath(outputPath),
  ], 120_000);

  if (result.exitCode === 0) {
    return ok(undefined);
  }

  if (result.exitCode === 127) {
    return err(integrationError("ffmpeg", `ffmpeg not found: ${result.stderr}. Install with: brew install ffmpeg`));
  }

  return err(integrationError("ffmpeg", `Conversion failed (exit ${result.exitCode}): ${result.stderr.slice(0, 200)}`));
}

// ── Implementation ───────────────────────────────────────────────────────

export function createAudioCaptureService(
  deps: AudioCaptureServiceDependencies
): AudioCaptureServiceResult {
  const { logger, dataDir, commandExecutor, whisperService, audioTranscriptsRepo, encryptionService } = deps;

  return {
    async processUpload(params): Promise<Result<ProcessedTranscript, DomainError>> {
      const {
        audioBuffer,
        mimeType,
        meetingTitle = "Untitled Meeting",
        meetingUrl,
        startTime,
        endTime,
      } = params;

      if (audioBuffer.length === 0) {
        return err(validationError("Audio buffer is empty"));
      }

      // Ensure data directory exists
      await mkdir(dataDir, { recursive: true });

      const fileId = randomUUID();
      const isWebm = mimeType.includes("webm") || mimeType.includes("opus");
      const inputExt = isWebm ? "webm" : "wav";
      const inputPath = join(dataDir, `tmp-${fileId}.${inputExt}`);
      const wavPath = join(dataDir, `tmp-${fileId}.wav`);

      try {
        // Write uploaded audio to temp file
        await writeFile(inputPath, audioBuffer);
        logger.info(
          { inputPath, sizeBytes: audioBuffer.length, mimeType },
          "Audio file saved for processing"
        );

        // Convert to WAV if needed
        if (isWebm) {
          const convertResult = await convertToWav(commandExecutor, inputPath, wavPath);
          if (convertResult._tag === "Err") return convertResult;
          logger.info({ wavPath }, "Converted to WAV");
        }

        const transcribeFilePath = isWebm ? wavPath : inputPath;

        // Transcribe with Whisper
        const transcribeResult = await whisperService.transcribe(transcribeFilePath);
        if (transcribeResult._tag === "Err") return transcribeResult;

        const transcript = transcribeResult.value;

        // Encrypt transcript content
        const contentJson = JSON.stringify({
          segments: transcript.segments,
          fullText: transcript.fullText,
        });
        const { encryptedData, iv } = encryptionService.encrypt(contentJson);

        // Store in database
        const stored = await audioTranscriptsRepo.create({
          meetingTitle,
          meetingUrl: meetingUrl || null,
          source: "chrome-extension",
          startTime,
          endTime,
          durationSeconds: transcript.durationSeconds,
          language: transcript.language,
          whisperModel: transcript.modelUsed,
          segmentCount: transcript.segments.length,
          encryptedContent: encryptedData,
          iv,
        });

        // Index in FTS5
        const ftsEntries: FtsEntry[] = transcript.segments.map((seg) => ({
          transcriptId: stored.id,
          textContent: seg.text,
        }));
        await audioTranscriptsRepo.insertFtsEntries(ftsEntries);

        logger.info(
          {
            id: stored.id,
            segments: transcript.segments.length,
            durationSeconds: transcript.durationSeconds,
            processingTimeMs: transcript.processingTimeMs,
          },
          "Audio transcript processed and stored"
        );

        return ok({
          id: stored.id,
          meetingTitle,
          startTime,
          endTime,
          durationSeconds: transcript.durationSeconds,
          segmentCount: transcript.segments.length,
          language: transcript.language,
          whisperModel: transcript.modelUsed,
          processingTimeMs: transcript.processingTimeMs,
        });
      } finally {
        // Keep temp files for debugging during development
        // TODO: uncomment cleanup once transcription is verified working
        // try {
        //   await unlink(inputPath).catch(() => {});
        //   if (isWebm) await unlink(wavPath).catch(() => {});
        // } catch {
        //   // Non-critical cleanup
        // }
        logger.info({ inputPath, wavPath }, "Temp audio files kept for debugging");
      }
    },
  };
}
