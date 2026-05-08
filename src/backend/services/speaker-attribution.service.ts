import type { Logger } from "pino";
import { spawn } from "node:child_process";
import type { Result, DomainError } from "../../shared/result.js";
import { ok, err, integrationError } from "../../shared/result.js";
import type { TranscriptionSegment } from "./whisper-transcription.service.js";

// ── Types ────────────────────────────────────────────────────────────────

export type SpeakerAttributionDeps = {
  readonly logger: Logger;
};

export type AttributedSegment = TranscriptionSegment & {
  speaker: string;
};

export interface SpeakerAttributionService {
  attributeSpeakers(params: {
    segments: TranscriptionSegment[];
    attendees: string[];
    meetingTitle?: string;
  }): Promise<Result<AttributedSegment[], DomainError>>;
}

// ── Claude CLI runner ────────────────────────────────────────────────────

function runClaudeCli(
  prompt: string,
  timeoutMs: number = 120_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const envPath = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      process.env.PATH ?? "",
    ].join(":");

    const proc = spawn("claude", [
      "-p",
      "--permission-mode", "bypassPermissions",
    ], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: envPath },
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({ stdout, stderr: stderr + "\nClaude CLI timed out", exitCode: 124 });
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

// ── Implementation ───────────────────────────────────────────────────────

export function createSpeakerAttributionService(
  deps: SpeakerAttributionDeps,
): SpeakerAttributionService {
  const { logger } = deps;

  return {
    async attributeSpeakers(params) {
      const { segments, attendees, meetingTitle } = params;

      // Build a compact transcript — include timestamps and text only
      const compactTranscript = segments.map((seg) => {
        return `[${seg.startTime}] ${seg.text}`;
      }).join("\n");

      // Check if whisper already detected multiple speakers via --tdrz
      const uniqueSpeakers = new Set(segments.map((s) => s.speaker).filter(Boolean));
      const hasSpeakerTurns = uniqueSpeakers.size > 1;

      const attendeeList = attendees.length > 0
        ? `Known attendees: ${attendees.join(", ")}`
        : "No attendee list available — use generic labels like Speaker A, Speaker B, etc.";

      const prompt = hasSpeakerTurns
        // Case 1: Whisper detected speaker turns — just need name assignment
        ? `You are a meeting transcript speaker attribution assistant.

The transcript below has speaker labels from automatic diarization (Speaker 1, Speaker 2, etc.). Assign the correct name to each speaker label.

Meeting title: ${meetingTitle || "Unknown"}
${attendeeList}

Transcript with existing speaker labels:
${segments.map((seg) => `[${seg.startTime}] ${seg.speaker || "Speaker 1"}: ${seg.text}`).join("\n")}

Respond ONLY with a valid JSON object mapping speaker labels to names. Example:
{"Speaker 1": "John Smith", "Speaker 2": "Jane Doe"}

If attendee names are provided, use them. Otherwise use "Speaker A", "Speaker B" etc.
Respond with ONLY the JSON object, no other text.`

        // Case 2: No speaker turns detected — Claude must identify turns from context
        : `You are a meeting transcript speaker diarization and attribution assistant.

The transcript below is from a meeting with multiple participants, but the automatic speaker detection failed — all text is labeled as one speaker. Your job is to:
1. Identify where speaker changes occur based on conversational cues (questions followed by answers, greetings, name mentions, topic shifts, different perspectives)
2. Assign a speaker label to each segment

Meeting title: ${meetingTitle || "Unknown"}
${attendeeList}

Transcript (timestamps help identify natural pauses between speakers):
${compactTranscript}

Respond ONLY with a valid JSON array where each element corresponds to a transcript segment (in order). Each element should be a speaker name or label. Example for 6 segments:
["John Smith", "John Smith", "Jane Doe", "Jane Doe", "John Smith", "Jane Doe"]

Rules:
- The array length MUST exactly match the number of transcript segments (${segments.length} segments)
- If attendee names are provided, use them
- If no attendees, use "Speaker A", "Speaker B", etc.
- Use conversational context to determine who is speaking
- When in doubt, keep the same speaker as the previous segment
Respond with ONLY the JSON array, no other text.`;

      try {
        const result = await runClaudeCli(prompt);

        if (result.exitCode !== 0) {
          logger.warn(
            { exitCode: result.exitCode, stderr: result.stderr.slice(0, 200) },
            "Speaker attribution via Claude CLI failed — keeping generic labels",
          );
          return ok(segments as AttributedSegment[]);
        }

        if (hasSpeakerTurns) {
          // Parse mapping: {"Speaker 1": "John Smith", "Speaker 2": "Jane Doe"}
          const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            logger.warn("Claude CLI response did not contain a JSON mapping");
            return ok(segments as AttributedSegment[]);
          }

          const mapping = JSON.parse(jsonMatch[0]) as Record<string, string>;
          const attributed: AttributedSegment[] = segments.map((seg) => ({
            ...seg,
            speaker: (seg.speaker && mapping[seg.speaker]) || seg.speaker || "Unknown",
          }));

          logger.info({ mapping, attendeeCount: attendees.length }, "Speaker name mapping completed");
          return ok(attributed);
        } else {
          // Parse array: ["John", "John", "Jane", "Jane", "John"]
          const jsonMatch = result.stdout.match(/\[[\s\S]*\]/);
          if (!jsonMatch) {
            logger.warn("Claude CLI response did not contain a JSON array");
            return ok(segments as AttributedSegment[]);
          }

          const speakerLabels = JSON.parse(jsonMatch[0]) as string[];
          const attributed: AttributedSegment[] = segments.map((seg, i) => ({
            ...seg,
            speaker: speakerLabels[i] || seg.speaker || "Unknown",
          }));

          logger.info(
            { uniqueSpeakers: [...new Set(speakerLabels)], segmentCount: segments.length },
            "Speaker diarization + attribution completed",
          );
          return ok(attributed);
        }
      } catch (error) {
        logger.error({ error }, "Speaker attribution failed");
        return err(
          integrationError("claude-cli", `Speaker attribution failed: ${error instanceof Error ? error.message : String(error)}`),
        );
      }
    },
  };
}
