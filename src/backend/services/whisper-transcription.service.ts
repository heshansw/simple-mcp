import type { Logger } from "pino";
import { spawn } from "node:child_process";
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
  hasWhisper: boolean;
  hasFfmpeg: boolean;
  whisperVersion: string | null;
  ffmpegVersion: string | null;
  modelPath: string | null;
  diagnosticMessages: string[];
};

// ── Dependencies ─────────────────────────────────────────────────────────

export type WhisperTranscriptionDependencies = {
  logger: Logger;
  whisperBinPath?: string; // default: "whisper-cpp"
  modelName?: string; // default: "large-v3"
  modelsDir?: string; // default: ~/.simple-mcp/models/
};

// ── Service interface ────────────────────────────────────────────────────

export interface WhisperTranscriptionServiceResult {
  transcribe(audioFilePath: string): Promise<Result<TranscriptionResult, DomainError>>;
  checkPrerequisites(): Promise<Result<WhisperPrerequisites, DomainError>>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number = 600_000 // 10 min default
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    // Ensure Homebrew paths are available (MCP stdio process may not inherit user's shell PATH)
    const envPath = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      process.env.PATH ?? "",
    ].join(":");
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: envPath },
    });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ stdout, stderr: stderr + "\nProcess timed out", exitCode: 124 });
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: error.message, exitCode: 127 });
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
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
  const { logger } = deps;
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

      // Validate input file exists
      if (!(await fileExists(audioFilePath))) {
        return err(validationError(`Audio file not found: ${audioFilePath}`));
      }

      const modelPath = getModelPath();

      // Check model exists
      if (!(await fileExists(modelPath))) {
        return err(
          integrationError(
            "whisper",
            `Whisper model not found at ${modelPath}. Download it with: whisper-cpp --download-model ${modelName}`
          )
        );
      }

      // Create temp output directory
      const outputDir = join(dirname(audioFilePath), "whisper-out");
      await mkdir(outputDir, { recursive: true });

      try {
        // Run whisper-cpp
        const args = [
          "-m", modelPath,
          "-f", audioFilePath,
          "-ovtt",          // Output VTT format
          "-otxt",          // Output plain text
          "--output-dir", outputDir,
          "-l", "auto",     // Auto-detect language
        ];

        logger.info({ whisperBin, args }, "Starting Whisper transcription");

        const result = await runCommand(whisperBin, args, 600_000); // 10 min timeout

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

        // Parse output files
        const baseName = audioFilePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "audio";
        const vttPath = join(outputDir, `${baseName}.vtt`);
        const txtPath = join(outputDir, `${baseName}.txt`);

        let segments: TranscriptionSegment[] = [];
        let fullText = "";

        if (await fileExists(vttPath)) {
          const vttContent = await readFile(vttPath, "utf-8");
          segments = parseVtt(vttContent);
        }

        if (await fileExists(txtPath)) {
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
          if (await fileExists(vttPath)) await unlink(vttPath);
          if (await fileExists(txtPath)) await unlink(txtPath);
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

      // Check whisper-cpp
      const whisperResult = await runCommand(whisperBin, ["--help"], 5000);
      if (whisperResult.exitCode !== 127) {
        hasWhisper = true;
        const versionMatch = (whisperResult.stdout + whisperResult.stderr).match(/whisper[\s.]*(\d+\.\d+)/i);
        whisperVersion = versionMatch?.[1] ?? "installed";
        diagnosticMessages.push(`whisper-cpp: found (${whisperVersion})`);
      } else {
        diagnosticMessages.push(`whisper-cpp: NOT found. Install with: brew install whisper-cpp`);
      }

      // Check ffmpeg
      const ffmpegResult = await runCommand("ffmpeg", ["-version"], 5000);
      if (ffmpegResult.exitCode === 0) {
        hasFfmpeg = true;
        const versionMatch = ffmpegResult.stdout.match(/ffmpeg version (\S+)/);
        ffmpegVersion = versionMatch?.[1] ?? "installed";
        diagnosticMessages.push(`ffmpeg: found (${ffmpegVersion})`);
      } else {
        diagnosticMessages.push(`ffmpeg: NOT found. Install with: brew install ffmpeg`);
      }

      // Check model
      const modelPath = getModelPath();
      const hasModel = await fileExists(modelPath);
      if (hasModel) {
        diagnosticMessages.push(`Whisper model: found at ${modelPath}`);
      } else {
        diagnosticMessages.push(`Whisper model: NOT found at ${modelPath}. Download with: whisper-cpp --download-model ${modelName}`);
      }

      return ok({
        hasWhisper,
        hasFfmpeg,
        whisperVersion,
        ffmpegVersion,
        modelPath: hasModel ? modelPath : null,
        diagnosticMessages,
      });
    },
  };
}
