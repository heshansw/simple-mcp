import Anthropic from "@anthropic-ai/sdk";
import type { Result } from "@shared/result.js";
import { ok, err, integrationError } from "@shared/result.js";
import type { DomainError } from "@shared/result.js";
import type {
  FileAstMetrics,
  HealthScore,
  HealthIssue,
  SupportedLanguage,
} from "@shared/schemas/code-health.schema.js";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const MAX_SOURCE_CHARS = 50_000; // Truncate very large files to control cost

export type AiCodeReviewDeps = {
  getAnthropicApiKey: () => Promise<string | null>;
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
    model?: string,
  ): Promise<Result<AiCodeReviewResult, DomainError>>;
};

const SYSTEM_PROMPT = `You are an expert code reviewer specializing in code quality assessment. You receive a source file along with its static analysis metrics. Your job is to provide a QUALITATIVE review that identifies issues static analysis CANNOT detect.

Focus on:
1. **Design & Architecture**: Anti-patterns, god classes, poor separation of concerns, tight coupling
2. **Naming Quality**: Unclear variable/function/class names, misleading names, inconsistent conventions
3. **Error Handling**: Missing try/catch, unhandled promise rejections, swallowed errors, missing null checks
4. **Security**: XSS vulnerabilities, injection risks, hardcoded secrets, auth issues, unsafe data handling
5. **Dead Code**: Unreachable branches, unused variables/imports, commented-out code
6. **API Misuse**: Framework anti-patterns, deprecated API usage, incorrect usage patterns
7. **Testability**: Tight coupling that prevents unit testing, hidden dependencies, side effects
8. **Performance**: Unnecessary re-renders (React), N+1 queries, memory leaks, expensive operations in loops
9. **Readability**: Complex conditionals that should be extracted, deeply nested ternaries, unclear logic flow

Score strictly on a 1-10 scale:
- 9-10: Production-ready, well-designed, minimal issues
- 7-8: Good quality, minor improvements possible
- 5-6: Acceptable but has notable design/quality issues
- 3-4: Poor quality, significant refactoring needed
- 1-2: Critical issues, should not be deployed as-is

Return ONLY valid JSON (no markdown, no code fences):
{
  "aiScore": <number 1-10>,
  "aiGrade": "<A|B|C|D|F>",
  "issues": [
    {
      "severity": "critical|warning|info",
      "signal": "aiReview",
      "message": "<clear description of the issue>",
      "line": <line number or null if file-level>,
      "suggestion": "<actionable fix>"
    }
  ],
  "summary": "<1-2 sentence overall assessment>"
}`;

function buildUserPrompt(
  filePath: string,
  language: SupportedLanguage,
  staticMetrics: FileAstMetrics,
  staticScore: HealthScore,
  truncatedSource: string,
): string {
  const codeSmellsLine = staticMetrics.codeSmells
    ? `- Console statements: ${staticMetrics.codeSmells.consoleStatements}, TODOs: ${staticMetrics.codeSmells.todoFixmeCount}, Magic numbers: ${staticMetrics.codeSmells.magicNumberCount}`
    : "";

  return `Review this ${language} file: ${filePath}

## Static Analysis Summary
- Overall Score: ${staticScore.overall}/10 (Grade ${staticScore.grade})
- Complexity: ${staticScore.breakdown.complexity}/10 (avg cyclomatic: ${staticMetrics.averageCyclomatic.toFixed(1)})
- Maintainability: ${staticScore.breakdown.maintainability}/10 (MI: ${staticMetrics.maintainabilityIndex.toFixed(1)})
- Function Size: ${staticScore.breakdown.functionSize}/10
- Nesting Depth: ${staticScore.breakdown.nestingDepth}/10
- LOC: ${staticMetrics.loc}, Functions: ${staticMetrics.functions.length}
${codeSmellsLine}

## Source Code
\`\`\`${language}
${truncatedSource}
\`\`\`

Provide your qualitative review as JSON.`;
}

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

function extractJsonText(responseText: string): string {
  return responseText
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
      model,
    ) {
      const apiKey = await deps.getAnthropicApiKey();
      if (!apiKey) {
        return err(
          integrationError(
            "anthropic",
            "No Anthropic API key configured. Set ANTHROPIC_API_KEY or add an Anthropic connection.",
          ),
        );
      }

      const selectedModel = model ?? DEFAULT_MODEL;
      const truncatedSource =
        source.length > MAX_SOURCE_CHARS
          ? source.slice(0, MAX_SOURCE_CHARS) +
            "\n\n// ... [truncated for review] ..."
          : source;

      const userPrompt = buildUserPrompt(
        filePath,
        language,
        staticMetrics,
        staticScore,
        truncatedSource,
      );

      try {
        deps.logger.info("Starting AI code review", {
          filePath,
          model: selectedModel,
        });

        const client = new Anthropic({ apiKey });
        const message = await client.messages.create({
          model: selectedModel,
          max_tokens: 4096,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
        });

        const textBlock = message.content.find(
          (block) => block.type === "text",
        );
        if (!textBlock || textBlock.type !== "text") {
          return err(
            integrationError("anthropic", "No text response from Claude"),
          );
        }

        const responseText = textBlock.text.trim();
        const jsonText = extractJsonText(responseText);

        let parsed: RawAiResponse;
        try {
          parsed = JSON.parse(jsonText) as RawAiResponse;
        } catch {
          deps.logger.error("Failed to parse AI review response", {
            responseText: responseText.slice(0, 200),
          });
          return err(
            integrationError(
              "anthropic",
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
          model: selectedModel,
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        deps.logger.error("AI code review failed", { filePath, error: msg });
        return err(
          integrationError("anthropic", `AI review failed: ${msg}`),
        );
      }
    },
  };
}
