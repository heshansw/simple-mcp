import type { Logger } from "pino";
import { access, readFile, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  type Result,
  err,
  ok,
  integrationError,
  validationError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";
import type { CommandExecutor } from "./command-executor.service.js";

// ── Types ────────────────────────────────────────────────────────────────

export type TranscriptionSegment = {
  startTime: string; // "00:01:23.456"
  endTime: string;
  text: string;
};

export type TranscriptionResult = {
  segments: TranscriptionSegment[];
  fullText: string;
  language: string;
  durationSeconds: number;
  modelUsed: string;
  processingTimeMs: number;
};

export type WhisperPrerequisites = {
  sandboxMode: "local" | "docker";
  hasWhisper: boolean;
  hasFfmpeg: boolean;
  whisperVersion: string | null;
  ffmpegVersion: string | null;
  modelPath: string | null;
  containerRunning: boolean | null; // null when local mode
  diagnosticMessages: string[];
};

// ── Dependencies ─────────────────────────────────────────────────────────

export type WhisperTranscriptionDependencies = {
  logger: Logger;
  commandExecutor: CommandExecutor;
  sandboxMode: "local" | "docker";
  whisperBinPath?: string; // default: "whisper-cli"
  modelName?: string; // default: "large-v3"
  modelsDir?: string; // default: ~/.simple-mcp/models/
};

// ── Service interface ────────────────────────────────────────────────────

export interface WhisperTranscriptionServiceResult {
  transcribe(audioFilePath: string): Promise<Result<TranscriptionResult, DomainError>>;
  checkPrerequisites(): Promise<Result<WhisperPrerequisites, DomainError>>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function hostFileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseVtt(vttContent: string): TranscriptionSegment[] {
  const segments: TranscriptionSegment[] = [];
  const lines = vttContent.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!.trim();
    // Look for timestamp lines: "00:00:00.000 --> 00:00:05.000"
    const timestampMatch = line.match(
      /^(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})$/
    );

    if (timestampMatch) {
      const startTime = timestampMatch[1]!;
      const endTime = timestampMatch[2]!;
      i++;

      // Collect text lines until empty line
      const textLines: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== "") {
        textLines.push(lines[i]!.trim());
        i++;
      }

      if (textLines.length > 0) {
        segments.push({
          startTime,
          endTime,
          text: textLines.join(" "),
        });
      }
    } else {
      i++;
    }
  }

  return segments;
}

function timestampToSeconds(ts: string): number {
  const parts = ts.split(":");
  if (parts.length !== 3) return 0;
  const [h, m, sMs] = parts;
  const [s, ms] = (sMs ?? "0").split(".");
  return (
    parseInt(h ?? "0") * 3600 +
    parseInt(m ?? "0") * 60 +
    parseInt(s ?? "0") +
    parseInt(ms ?? "0") / 1000
  );
}

// ── Implementation ───────────────────────────────────────────────────────

export function createWhisperTranscriptionService(
  deps: WhisperTranscriptionDependencies
): WhisperTranscriptionServiceResult {
  const { logger, commandExecutor, sandboxMode } = deps;
  const whisperBin = deps.whisperBinPath ?? "whisper-cli";
  const modelName = deps.modelName ?? "large-v3";
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
  const modelsDir = deps.modelsDir ?? join(homeDir, ".simple-mcp", "models");

  function getModelPath(): string {
    // whisper-cpp typically stores models as ggml-<model>.bin
    return join(modelsDir, `ggml-${modelName}.bin`);
  }

  return {
    async transcribe(audioFilePath: string): Promise<Result<TranscriptionResult, DomainError>> {
      const startMs = Date.now();

      // Validate input file exists (on host — volume mount makes it visible in container)
      if (!(await commandExecutor.fileExists(commandExecutor.mapPath(audioFilePath)))) {
        return err(validationError(`Audio file not found: ${audioFilePath}`));
      }

      const modelPath = getModelPath();
      const mappedModelPath = commandExecutor.mapPath(modelPath);

      // Check model exists (inside container for docker mode)
      if (!(await commandExecutor.fileExists(mappedModelPath))) {
        return err(
          integrationError(
            "whisper",
            `Whisper model not found at ${modelPath}. Download it with: curl -L -o ${modelPath} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`
          )
        );
      }

      // Output file prefix (whisper-cli uses -of for output file path without extension)
      const outputDir = join(dirname(audioFilePath), "whisper-out");
      await mkdir(outputDir, { recursive: true });
      const outputFilePrefix = join(outputDir, "transcript");

      try {
        // Run whisper-cli with mapped paths (container paths for docker, host paths for local)
        const args = [
          "-m", commandExecutor.mapPath(modelPath),
          "-f", commandExecutor.mapPath(audioFilePath),
          "-of", commandExecutor.mapPath(outputFilePrefix),
          "-ovtt",
          "-otxt",
          "-l", "auto",
          "-np",
        ];

        logger.info({ whisperBin, args, sandboxMode }, "Starting Whisper transcription");

        const result = await commandExecutor.run(whisperBin, args, 600_000);

        if (result.exitCode !== 0) {
          logger.error(
            { exitCode: result.exitCode, stderr: result.stderr.slice(0, 500) },
            "Whisper transcription failed"
          );
          return err(
            integrationError(
              "whisper",
              `Whisper exited with code ${result.exitCode}: ${result.stderr.slice(0, 200)}`
            )
          );
        }

        // Parse output files (whisper-cli writes to <outputFilePrefix>.vtt and <outputFilePrefix>.txt)
        const vttPath = `${outputFilePrefix}.vtt`;
        const txtPath = `${outputFilePrefix}.txt`;

        let segments: TranscriptionSegment[] = [];
        let fullText = "";

        if (await hostFileExists(vttPath)) {
          const vttContent = await readFile(vttPath, "utf-8");
          segments = parseVtt(vttContent);
        }

        if (await hostFileExists(txtPath)) {
          fullText = (await readFile(txtPath, "utf-8")).trim();
        } else {
          fullText = segments.map((s) => s.text).join(" ");
        }

        // Calculate duration from last segment
        const lastSegment = segments[segments.length - 1];
        const durationSeconds = lastSegment
          ? timestampToSeconds(lastSegment.endTime)
          : 0;

        // Detect language from whisper output (stderr often contains it)
        const langMatch = result.stderr.match(/language:\s*(\w+)/i);
        const language = langMatch?.[1] ?? "en";

        const processingTimeMs = Date.now() - startMs;

        logger.info(
          { segments: segments.length, durationSeconds, processingTimeMs, language },
          "Whisper transcription completed"
        );

        // Clean up output files
        try {
          if (await hostFileExists(vttPath)) await unlink(vttPath);
          if (await hostFileExists(txtPath)) await unlink(txtPath);
        } catch {
          // Non-critical cleanup
        }

        return ok({
          segments,
          fullText,
          language,
          durationSeconds,
          modelUsed: modelName,
          processingTimeMs,
        });
      } catch (error) {
        logger.error({ error }, "Unexpected error during Whisper transcription");
        return err(
          integrationError("whisper", `Transcription failed: ${error instanceof Error ? error.message : String(error)}`)
        );
      }
    },

    async checkPrerequisites(): Promise<Result<WhisperPrerequisites, DomainError>> {
      const diagnosticMessages: string[] = [];
      let hasWhisper = false;
      let hasFfmpeg = false;
      let whisperVersion: string | null = null;
      let ffmpegVersion: string | null = null;
      let containerRunning: boolean | null = null;

      diagnosticMessages.push(`Sandbox mode: ${sandboxMode}`);

      if (sandboxMode === "docker") {
        // Check container is running
        const inspectResult = await commandExecutor.run("echo", ["ok"], 5_000);
        containerRunning = inspectResult.exitCode === 0;
        if (containerRunning) {
          diagnosticMessages.push("Docker container: running");
        } else {
          diagnosticMessages.push("Docker container: NOT running. Start with: pnpm docker:audio:up");
        }
      }

      // Check whisper-cpp (runs inside container for docker mode)
      const whisperResult = await commandExecutor.run(whisperBin, ["--help"], 5_000);
      if (whisperResult.exitCode !== 127) {
        hasWhisper = true;
        const versionMatch = (whisperResult.stdout + whisperResult.stderr).match(/whisper[\s.]*(\d+\.\d+)/i);
        whisperVersion = versionMatch?.[1] ?? "installed";
        diagnosticMessages.push(`whisper-cpp: found (${whisperVersion})`);
      } else {
        const installHint = sandboxMode === "docker"
          ? "Rebuild container: pnpm docker:audio:build"
          : "Install with: brew install whisper-cpp";
        diagnosticMessages.push(`whisper-cpp: NOT found. ${installHint}`);
      }

      // Check ffmpeg (runs inside container for docker mode)
      const ffmpegResult = await commandExecutor.run("ffmpeg", ["-version"], 5_000);
      if (ffmpegResult.exitCode === 0) {
        hasFfmpeg = true;
        const versionMatch = ffmpegResult.stdout.match(/ffmpeg version (\S+)/);
        ffmpegVersion = versionMatch?.[1] ?? "installed";
        diagnosticMessages.push(`ffmpeg: found (${ffmpegVersion})`);
      } else {
        const installHint = sandboxMode === "docker"
          ? "Rebuild container: pnpm docker:audio:build"
          : "Install with: brew install ffmpeg";
        diagnosticMessages.push(`ffmpeg: NOT found. ${installHint}`);
      }

      // Check model (inside container for docker mode, on host for local)
      const modelPath = getModelPath();
      const mappedModelPath = commandExecutor.mapPath(modelPath);
      const hasModel = await commandExecutor.fileExists(mappedModelPath);
      if (hasModel) {
        diagnosticMessages.push(`Whisper model: found at ${modelPath}`);
      } else {
        diagnosticMessages.push(
          `Whisper model: NOT found at ${modelPath}. Download with: curl -L -o ${modelPath} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`
        );
      }

      return ok({
        sandboxMode,
        hasWhisper,
        hasFfmpeg,
        whisperVersion,
        ffmpegVersion,
        modelPath: hasModel ? modelPath : null,
        containerRunning,
        diagnosticMessages,
      });
    },
  };
}
