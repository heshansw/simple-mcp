import { spawn } from "node:child_process";
import type { Result } from "@shared/result.js";
import { ok, err, integrationError } from "@shared/result.js";
import type { DomainError } from "@shared/result.js";
import type {
  FileAstMetrics,
  HealthScore,
  HealthIssue,
  SupportedLanguage,
} from "@shared/schemas/code-health.schema.js";

const MAX_SOURCE_CHARS = 50_000;
const CLI_TIMEOUT_MS = 120_000;

export type AiCodeReviewDeps = {
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export type AiCodeReviewResult = {
  readonly aiScore: number;
  readonly aiGrade: string;
  readonly issues: ReadonlyArray<HealthIssue>;
  readonly summary: string;
  readonly model: string;
};

export type AiCodeReviewService = {
  reviewFile(
    filePath: string,
    source: string,
    language: SupportedLanguage,
    staticMetrics: FileAstMetrics,
    staticScore: HealthScore,
  ): Promise<Result<AiCodeReviewResult, DomainError>>;
};

const REVIEW_PROMPT_TEMPLATE = `You are an expert code reviewer. Analyze the following source file and provide a quality assessment.

Focus on what static analysis CANNOT detect:
1. Design & Architecture: Anti-patterns, god classes, poor separation of concerns, tight coupling
2. Naming Quality: Unclear variable/function/class names, misleading names
3. Error Handling: Missing try/catch, unhandled rejections, swallowed errors, missing null checks
4. Security: XSS, injection risks, hardcoded secrets, auth issues
5. Dead Code: Unreachable branches, unused variables/imports, commented-out code
6. API Misuse: Framework anti-patterns, deprecated API usage
7. Testability: Tight coupling, hidden dependencies, side effects
8. Performance: Unnecessary re-renders (React), memory leaks, expensive operations in loops
9. Readability: Complex conditionals, deeply nested ternaries, unclear logic flow

Score strictly on a 1-10 scale:
- 9-10: Production-ready, well-designed, minimal issues
- 7-8: Good quality, minor improvements possible
- 5-6: Acceptable but has notable design/quality issues
- 3-4: Poor quality, significant refactoring needed
- 1-2: Critical issues, should not be deployed as-is

## Static Analysis Summary
- Overall Score: STATIC_SCORE/10 (Grade STATIC_GRADE)
- Complexity: COMPLEXITY_SCORE/10 (avg cyclomatic: AVG_CYCLOMATIC)
- Maintainability: MAINTAINABILITY_SCORE/10 (MI: MI_VALUE)
- LOC: LOC_COUNT, Functions: FUNC_COUNT
CODE_SMELLS_LINE

## Source Code (LANGUAGE): FILE_PATH
\`\`\`LANGUAGE
SOURCE_CODE
\`\`\`

Return ONLY valid JSON (no markdown fences, no explanation):
{"aiScore": <1-10>, "aiGrade": "<A|B|C|D|F>", "issues": [{"severity": "critical|warning|info", "signal": "aiReview", "message": "<description>", "line": <number or null>, "suggestion": "<fix>"}], "summary": "<1-2 sentences>"}`;

type RawAiIssue = {
  severity?: string;
  signal?: string;
  message?: string;
  line?: number | null;
  suggestion?: string;
};

type RawAiResponse = {
  aiScore?: number;
  aiGrade?: string;
  issues?: ReadonlyArray<RawAiIssue>;
  summary?: string;
};

function runClaudeCli(
  prompt: string,
  timeoutMs: number = CLI_TIMEOUT_MS,
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

function buildPrompt(
  filePath: string,
  language: SupportedLanguage,
  staticMetrics: FileAstMetrics,
  staticScore: HealthScore,
  truncatedSource: string,
): string {
  const codeSmellsLine = staticMetrics.codeSmells
    ? `- Code Smells: ${staticMetrics.codeSmells.consoleStatements} console stmts, ${staticMetrics.codeSmells.todoFixmeCount} TODOs, ${staticMetrics.codeSmells.magicNumberCount} magic numbers, ${staticMetrics.codeSmells.isGodFile ? "GOD FILE" : "ok"}`
    : "";

  return REVIEW_PROMPT_TEMPLATE
    .replace(/STATIC_SCORE/g, String(staticScore.overall))
    .replace(/STATIC_GRADE/g, staticScore.grade)
    .replace(/COMPLEXITY_SCORE/g, String(staticScore.breakdown.complexity))
    .replace(/AVG_CYCLOMATIC/g, staticMetrics.averageCyclomatic.toFixed(1))
    .replace(/MAINTAINABILITY_SCORE/g, String(staticScore.breakdown.maintainability))
    .replace(/MI_VALUE/g, staticMetrics.maintainabilityIndex.toFixed(1))
    .replace(/LOC_COUNT/g, String(staticMetrics.loc))
    .replace(/FUNC_COUNT/g, String(staticMetrics.functions.length))
    .replace(/CODE_SMELLS_LINE/g, codeSmellsLine)
    .replace(/LANGUAGE/g, language)
    .replace(/FILE_PATH/g, filePath)
    .replace(/SOURCE_CODE/g, truncatedSource);
}

function parseAiIssues(
  rawIssues: ReadonlyArray<RawAiIssue>,
  filePath: string,
): HealthIssue[] {
  return rawIssues.map((issue) => ({
    severity:
      issue.severity === "critical" ||
      issue.severity === "warning" ||
      issue.severity === "info"
        ? issue.severity
        : "info",
    signal: "aiReview",
    message: issue.message ?? "AI-identified issue",
    filePath,
    line: typeof issue.line === "number" ? issue.line : undefined,
    suggestion: issue.suggestion,
  }));
}

function extractJson(text: string): string {
  // Try to find JSON in the response — Claude CLI may include extra text
  const jsonMatch = text.match(/\{[\s\S]*"aiScore"[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  // Fallback: strip markdown code fences
  return text
    .trim()
    .replace(/^```json?\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

export function createAiCodeReviewService(
  deps: AiCodeReviewDeps,
): AiCodeReviewService {
  return {
    async reviewFile(
      filePath,
      source,
      language,
      staticMetrics,
      staticScore,
    ) {
      const truncatedSource =
        source.length > MAX_SOURCE_CHARS
          ? source.slice(0, MAX_SOURCE_CHARS) +
            "\n\n// ... [truncated for review] ..."
          : source;

      const prompt = buildPrompt(
        filePath,
        language,
        staticMetrics,
        staticScore,
        truncatedSource,
      );

      try {
        deps.logger.info("Starting AI code review via Claude CLI", { filePath });

        const result = await runClaudeCli(prompt);

        if (result.exitCode !== 0) {
          deps.logger.error("Claude CLI code review failed", {
            filePath,
            exitCode: result.exitCode,
            stderr: result.stderr.slice(0, 300),
          });
          return err(
            integrationError(
              "claude-cli",
              `Claude CLI exited with code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
            ),
          );
        }

        const responseText = result.stdout.trim();
        if (!responseText) {
          return err(
            integrationError("claude-cli", "Claude CLI returned empty response"),
          );
        }

        const jsonText = extractJson(responseText);

        let parsed: RawAiResponse;
        try {
          parsed = JSON.parse(jsonText) as RawAiResponse;
        } catch {
          deps.logger.error("Failed to parse AI review response", {
            responseText: responseText.slice(0, 300),
          });
          return err(
            integrationError(
              "claude-cli",
              "Failed to parse AI review response as JSON",
            ),
          );
        }

        const aiScore =
          typeof parsed.aiScore === "number"
            ? Math.max(1, Math.min(10, parsed.aiScore))
            : 5;
        const aiGrade =
          typeof parsed.aiGrade === "string" ? parsed.aiGrade : "C";
        const summary =
          typeof parsed.summary === "string"
            ? parsed.summary
            : "AI review completed.";

        const issues = parseAiIssues(parsed.issues ?? [], filePath);

        deps.logger.info("AI code review completed", {
          filePath,
          aiScore,
          aiGrade,
          issueCount: issues.length,
        });

        return ok({
          aiScore,
          aiGrade,
          issues,
          summary,
          model: "claude-cli",
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        deps.logger.error("AI code review failed", { filePath, error: msg });
        return err(
          integrationError("claude-cli", `AI review failed: ${msg}`),
        );
      }
    },
  };
}
