import type { Logger } from "pino";
import type { Result, DomainError } from "@shared/result";
import { ok, err, isErr, integrationError, domainErrorMessage } from "@shared/result.js";
import type { GeminiCliReviewOutput } from "@shared/schemas/gemini-cli.schema";
import { GeminiCliReviewOutputSchema } from "@shared/schemas/gemini-cli.schema.js";
import type { GeminiCliService } from "./gemini-cli.service.js";
import type { GitHubService, GitHubPullRequest, GitHubPRFile } from "./github.service.js";

// ── Types ────────────────────────────────────────────────────────────────

export type GeminiCliReviewParams = {
  readonly sessionId: string;
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
  readonly agentId: string;
};

export type GeminiCliReviewResult = GeminiCliReviewOutput & {
  readonly model: string;
  readonly durationMs: number;
};

export type GeminiCliReviewService = {
  readonly reviewPR: (
    params: GeminiCliReviewParams
  ) => Promise<Result<GeminiCliReviewResult, DomainError>>;
};

type GeminiCliReviewServiceDeps = {
  readonly logger: Logger;
  readonly geminiCli: GeminiCliService;
  readonly githubService: GitHubService;
};

// ── Prompt builder ───────────────────────────────────────────────────────

function buildDiffContent(pr: GitHubPullRequest, files: readonly GitHubPRFile[]): string {
  const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

  const fileDiffs = files.map((f) => {
    const patch = f.patch ?? "(binary file or too large to display)";
    return [
      `## ${f.filename}`,
      `Status: ${f.status} | +${f.additions} -${f.deletions} (${f.changes} total)`,
      "",
      "```diff",
      patch,
      "```",
    ].join("\n");
  });

  return [
    `# Pull Request #${pr.number}: ${pr.title}`,
    "",
    `**Author:** ${pr.user.login}`,
    `**Branch:** ${pr.head.ref} → ${pr.base.ref}`,
    `**State:** ${pr.state}${pr.draft ? " (draft)" : ""}`,
    "",
    "## Description",
    "",
    pr.body || "(no description provided)",
    "",
    `## Changed Files (${files.length} files, +${totalAdditions} -${totalDeletions})`,
    "",
    ...fileDiffs,
  ].join("\n");
}

function buildReviewPrompt(diffContent: string): string {
  return `You are a senior Backend PR Reviewer focused on code quality for server-side applications.

## Review Checklist

### API Design
- RESTful conventions: proper HTTP methods, status codes, resource naming
- Request/response validation at the boundary
- Consistent error response format across all endpoints

### Error Handling
- Expected failures use typed result types — never throw for business logic
- No swallowed exceptions (empty catch blocks)
- Error messages are user-safe

### Security
- Input validation and sanitization on all external inputs
- Parameterized queries — no string concatenation for SQL
- Authentication/authorization checked on every request
- Secrets never logged or returned in responses

### Performance
- N+1 query detection in database access patterns
- Pagination for unbounded result sets
- No blocking operations on the main thread

### Architecture
- Single responsibility per file/class/function
- Dependencies flow inward
- No circular imports
- Dependency injection

---

Here is the PR to review:

${diffContent}

---

Respond with ONLY a valid JSON object (no markdown fences, no extra text) in this exact format:

{
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "body": "Your overall review summary in markdown format. Include sections for Critical issues, Important issues, Suggestions, and Praise where applicable.",
  "comments": [
    {
      "path": "relative/path/to/file.ts",
      "position": 10,
      "body": "Description of the issue and suggested fix",
      "category": "bug"
    }
  ]
}

Rules for the JSON response:
- "verdict" must be exactly one of: "APPROVE", "REQUEST_CHANGES", or "COMMENT"
- "body" is your overall review in markdown
- "comments" is an array of inline comments (can be empty if no specific line-level feedback)
- Each comment "position" is the line number within the diff hunk (not the file line number)
- Each comment "category" must be one of: "bug", "security", "performance", "style", "test", "docs", "other"
- Use "REQUEST_CHANGES" for critical bugs or security issues
- Use "COMMENT" for suggestions and improvements
- Use "APPROVE" only if the code is clean with at most minor style nits`;
}

// ── Parse helpers ────────────────────────────────────────────────────────

function stripMarkdownFences(text: string): string {
  // Strip ```json ... ``` fences if present
  const fencePattern = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/;
  const match = text.trim().match(fencePattern);
  return match?.[1] ?? text.trim();
}

function parseReviewOutput(raw: string): GeminiCliReviewOutput {
  const cleaned = stripMarkdownFences(raw);
  const parsed: unknown = JSON.parse(cleaned);
  return GeminiCliReviewOutputSchema.parse(parsed);
}

// ── Implementation ───────────────────────────────────────────────────────

export function createGeminiCliReviewService(
  deps: GeminiCliReviewServiceDeps
): GeminiCliReviewService {
  const { logger, geminiCli, githubService } = deps;

  return {
    async reviewPR(
      params: GeminiCliReviewParams
    ): Promise<Result<GeminiCliReviewResult, DomainError>> {
      const { owner, repo, prNumber } = params;

      logger.info(
        { owner, repo, prNumber, sessionId: params.sessionId },
        "Starting Gemini CLI PR review"
      );

      // 1. Fetch PR details and files in parallel
      const [prResult, filesResult] = await Promise.all([
        githubService.getPullRequest(owner, repo, prNumber),
        githubService.getPullRequestFiles(owner, repo, prNumber),
      ]);

      if (isErr(prResult)) {
        return err(
          integrationError(
            "gemini-cli-review",
            `Failed to fetch PR: ${domainErrorMessage(prResult.error)}`
          )
        );
      }

      if (isErr(filesResult)) {
        return err(
          integrationError(
            "gemini-cli-review",
            `Failed to fetch PR files: ${domainErrorMessage(filesResult.error)}`
          )
        );
      }

      // 2. Build prompt
      const diffContent = buildDiffContent(prResult.value, filesResult.value);
      const prompt = buildReviewPrompt(diffContent);

      // 3. Invoke Gemini CLI
      const cliResult = await geminiCli.execute(prompt);
      if (isErr(cliResult)) {
        return cliResult;
      }

      const { stdout, durationMs } = cliResult.value;

      // 4. Parse structured output
      try {
        const reviewOutput = parseReviewOutput(stdout);
        logger.info(
          {
            owner,
            repo,
            prNumber,
            verdict: reviewOutput.verdict,
            commentCount: reviewOutput.comments.length,
            durationMs,
          },
          "Gemini CLI review parsed successfully"
        );

        return ok({
          ...reviewOutput,
          model: "gemini-2.5-pro",
          durationMs,
        });
      } catch (parseError) {
        // Fallback: use raw output as comment body
        logger.warn(
          {
            owner,
            repo,
            prNumber,
            parseError: parseError instanceof Error ? parseError.message : String(parseError),
          },
          "Failed to parse Gemini CLI JSON output, using raw text fallback"
        );

        return ok({
          verdict: "COMMENT" as const,
          body: stdout.trim(),
          comments: [],
          model: "gemini-2.5-pro",
          durationMs,
        });
      }
    },
  };
}
