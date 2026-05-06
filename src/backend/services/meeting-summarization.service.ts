import type { Logger } from "pino";
import { spawn } from "node:child_process";
import type { Result, DomainError } from "../../shared/result.js";
import { ok, err, integrationError } from "../../shared/result.js";
import type { AudioTranscriptsRepository } from "../db/repositories/audio-transcripts.repository.js";
import type {
  MeetingAnalysesRepository,
  MeetingAnalysis,
} from "../db/repositories/meeting-analyses.repository.js";
import type { EncryptionService } from "./encryption.service.js";

// ── Types ────────────────────────────────────────────────────────────────

export type MeetingSummarizationServiceDeps = {
  readonly logger: Logger;
  readonly audioTranscriptsRepo: AudioTranscriptsRepository;
  readonly meetingAnalysesRepo: MeetingAnalysesRepository;
  readonly encryptionService: EncryptionService;
};

export interface MeetingSummarizationService {
  summarizeTranscript(
    transcriptId: string
  ): Promise<Result<MeetingAnalysis, DomainError>>;
}

// ── Claude CLI runner ────────────────────────────────────────────────────

function runClaudeCli(
  prompt: string,
  allowedTools: readonly string[],
  timeoutMs: number = 300_000 // 5 min default
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const envPath = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      process.env.PATH ?? "",
    ].join(":");

    const args = [
      "-p",                            // Print mode: non-interactive, output response and exit
      "--allowedTools",                 // Restrict to specific MCP tools
      allowedTools.join(","),
      "--permission-mode", "bypassPermissions",  // Allow tool calls without prompts
    ];

    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: envPath },
    });

    // Pipe the prompt via stdin (avoids argv size limits for large transcripts)
    proc.stdin.write(prompt);
    proc.stdin.end();

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      resolve({
        stdout,
        stderr: stderr + "\nClaude CLI timed out",
        exitCode: 124,
      });
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: error.message,
        exitCode: 127,
      });
    });
  });
}

// ── System prompt for the summarizer ─────────────────────────────────────

const SUMMARIZER_SYSTEM_PROMPT = `You are a meeting summarization agent. You analyze meeting transcripts and enrich them with context from Jira and GitHub integrations available via MCP tools.

## Analysis Steps

1. Read the transcript carefully — capture EVERYTHING discussed
2. Use jira_search_issues to find any Jira tickets mentioned (patterns like PROJ-123, project names, epic names). If the tool fails, skip silently.
3. Use github_list_prs or github_search_code to find related PRs or code references. If tools fail, skip silently.
4. Produce the structured summary below.

## Output Format

### Meeting Overview
- **Title:** [meeting title]
- **Date:** [date and time]
- **Duration:** [duration]
- **Participants:** [identified/inferred participants]

### Summary
[Comprehensive coverage of ALL topics discussed. Each major topic as a separate bullet point.]

### Decisions Made
[Numbered list with context]

### Referenced Jira Tickets
[For each found ticket:]
- **[TICKET-ID]** — [summary] | Status: [status] | [how it relates to meeting]

If none found: "No Jira tickets referenced."

### Referenced Pull Requests
[For each found PR:]
- **PR #[number]** in [repo] — [title] | Status: [status] | [context]

If none found: "No pull requests referenced."

### Action Items
[For each action item:]
1. **[Description]**
   - Owner: [person or "Unassigned"]
   - Deadline: [if mentioned or "Not specified"]
   - Suggested Jira: Create [issue type] in [project/epic] — [rationale]

### Follow-ups
[Unresolved questions, topics for next meeting, scheduled follow-ups]

## Rules
- Be factual — only include information from the transcript
- If a tool call fails, skip that enrichment silently
- Never create Jira tickets — only SUGGEST where to create them
- Include ALL discussion points — thoroughness over brevity`;

// ── Allowed MCP tools for the summarizer ─────────────────────────────────

const SUMMARIZER_TOOLS = [
  "mcp__simple-mcp__audio_get_transcript",
  "mcp__simple-mcp__audio_search_transcripts",
  "mcp__simple-mcp__jira_search_issues",
  "mcp__simple-mcp__github_list_prs",
  "mcp__simple-mcp__github_get_my_prs",
  "mcp__simple-mcp__github_search_code",
] as const;

// ── Implementation ───────────────────────────────────────────────────────

export function createMeetingSummarizationService(
  deps: MeetingSummarizationServiceDeps
): MeetingSummarizationService {
  const {
    logger,
    audioTranscriptsRepo,
    meetingAnalysesRepo,
    encryptionService,
  } = deps;

  return {
    async summarizeTranscript(
      transcriptId: string
    ): Promise<Result<MeetingAnalysis, DomainError>> {
      logger.info({ transcriptId }, "Starting background auto-summarization via Claude CLI");

      // 1. Fetch transcript metadata (for title, date, duration)
      const transcript = await audioTranscriptsRepo.findById(transcriptId);
      if (!transcript) {
        return err(
          integrationError(
            "meeting-summarization",
            `Transcript not found: ${transcriptId}`
          )
        );
      }

      // 2. Build the prompt — tell Claude CLI to fetch the transcript via MCP tool
      const meetingTitle = transcript.meetingTitle || "Untitled Meeting";
      const date = new Date(transcript.startTime).toLocaleString();
      const durationMins = Math.round(transcript.durationSeconds / 60);

      const prompt = `${SUMMARIZER_SYSTEM_PROMPT}

---

Now analyze this meeting:
- **Title:** ${meetingTitle}
- **Date:** ${date}
- **Duration:** ${durationMins} minutes
- **Transcript ID:** ${transcriptId}

First, use the audio_get_transcript tool with transcript_id="${transcriptId}" to retrieve the full transcript text. Then follow the analysis steps and produce the structured summary.`;

      // 3. Run Claude CLI in background
      logger.info(
        { transcriptId, meetingTitle },
        "Spawning Claude CLI for meeting summarization"
      );

      const result = await runClaudeCli(prompt, SUMMARIZER_TOOLS);

      if (result.exitCode !== 0) {
        logger.error(
          {
            transcriptId,
            exitCode: result.exitCode,
            stderr: result.stderr.slice(0, 500),
          },
          "Claude CLI summarization failed"
        );
        return err(
          integrationError(
            "meeting-summarization",
            `Claude CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 200)}`
          )
        );
      }

      const summary = result.stdout.trim();
      if (!summary) {
        return err(
          integrationError(
            "meeting-summarization",
            "Claude CLI returned empty response"
          )
        );
      }

      // 4. Encrypt and store the analysis
      const { encryptedData, iv } = encryptionService.encrypt(summary);

      try {
        const analysis = await meetingAnalysesRepo.create({
          transcriptId,
          analysisType: "auto-summary",
          title: `Summary: ${meetingTitle}`,
          encryptedContent: encryptedData,
          iv,
          model: "claude-cli",
          inputTokens: 0,
          outputTokens: 0,
        });

        logger.info(
          {
            transcriptId,
            analysisId: analysis.id,
            summaryLength: summary.length,
          },
          "Auto-summarization completed and stored in database"
        );

        return ok(analysis);
      } catch (error) {
        return err(
          integrationError(
            "meeting-summarization",
            `Failed to store analysis: ${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
    },
  };
}
