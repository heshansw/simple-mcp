import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "pino";
import type { GitHubPRFile, GitHubPullRequest } from "./github.service.js";

export type ReviewComment = {
  /** File path relative to repo root */
  path: string;
  /** The diff hunk position (line in the diff, not the file) */
  position: number;
  /** The review comment body */
  body: string;
};

export type AIReviewResult = {
  /** Overall review summary */
  summary: string;
  /** Per-file inline comments */
  comments: ReviewComment[];
  /** Overall verdict: approve, request changes, or comment */
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
};

export interface AIReviewDependencies {
  logger: Logger;
  getAnthropicApiKey: () => Promise<string | null>;
}

export interface AIReviewService {
  reviewPR(
    pr: GitHubPullRequest,
    files: GitHubPRFile[]
  ): Promise<AIReviewResult>;
}

const SYSTEM_PROMPT = `You are an expert code reviewer. You analyze pull request diffs and provide thorough, constructive feedback.

Your review should cover:
1. **Code Quality**: Readability, maintainability, naming, DRY principle violations
2. **Bugs & Logic Errors**: Off-by-one errors, null/undefined handling, race conditions, edge cases
3. **Security**: SQL injection, XSS, credential exposure, insecure patterns
4. **Performance**: Unnecessary allocations, N+1 queries, missing memoization, algorithmic complexity
5. **Testing**: Missing test cases, untested edge cases, test quality
6. **Best Practices**: TypeScript strict mode compliance, error handling patterns, API design

Rules:
- Be specific — reference the exact line and code snippet
- Be constructive — suggest the fix, don't just point out problems
- Acknowledge good patterns when you see them
- Don't nitpick formatting or style unless it harms readability
- Focus on issues that matter — security and correctness first

You MUST respond with valid JSON in this exact format:
{
  "summary": "A 2-4 sentence overall assessment of the PR",
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "comments": [
    {
      "path": "src/example.ts",
      "position": 5,
      "body": "Description of the issue and suggested fix"
    }
  ]
}

The "position" field is the line number within the diff hunk (starting from 1), NOT the file line number.
Count diff lines from the top of each file's patch, including context lines, additions (+), and deletions (-).
Only comment on added (+) or context lines that are relevant to changes, never on removed (-) lines.

If the PR looks good overall with only minor suggestions, use "APPROVE" as the verdict.
If there are significant issues that should be fixed before merging, use "REQUEST_CHANGES".
If you have feedback but it's mostly informational, use "COMMENT".

Return an empty comments array if there's nothing specific to flag.`;

function buildUserPrompt(
  pr: GitHubPullRequest,
  files: GitHubPRFile[]
): string {
  const filePatches = files
    .filter((f) => f.patch) // skip binary files
    .map((f) => {
      // Limit very large patches to avoid token explosion
      const patch =
        f.patch && f.patch.length > 3000
          ? f.patch.substring(0, 3000) + "\n... (patch truncated for length)"
          : f.patch;

      return `### File: ${f.filename} (${f.status}, +${f.additions} -${f.deletions})
\`\`\`diff
${patch}
\`\`\``;
    })
    .join("\n\n");

  return `## Pull Request: #${pr.number} — ${pr.title}

**Author:** ${pr.user.login}
**Branch:** ${pr.head.ref} → ${pr.base.ref}
**Description:** ${pr.body || "(no description)"}
**Files changed:** ${files.length}
**Total changes:** +${files.reduce((s, f) => s + f.additions, 0)} -${files.reduce((s, f) => s + f.deletions, 0)}

## Diffs

${filePatches}

Please review the above PR and respond with your review in the required JSON format.`;
}

export function createAIReviewService(
  deps: AIReviewDependencies
): AIReviewService {
  const { logger } = deps;

  return {
    async reviewPR(
      pr: GitHubPullRequest,
      files: GitHubPRFile[]
    ): Promise<AIReviewResult> {
      const apiKey = await deps.getAnthropicApiKey();
      if (!apiKey) {
        throw new Error(
          "No Anthropic API key configured. Set ANTHROPIC_API_KEY environment variable or add a Claude connection with an API key."
        );
      }

      const client = new Anthropic({ apiKey });

      const userPrompt = buildUserPrompt(pr, files);

      logger.info(
        {
          prNumber: pr.number,
          filesCount: files.length,
          promptLength: userPrompt.length,
        },
        "Sending PR to Claude for AI review"
      );

      const message = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      });

      // Extract text response
      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("No text response from Claude");
      }

      const rawText = textBlock.text.trim();

      // Parse JSON from response — handle potential markdown code fences
      let jsonStr = rawText;
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1]!.trim();
      }

      let parsed: {
        summary: string;
        verdict: string;
        comments: Array<{ path: string; position: number; body: string }>;
      };

      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        logger.warn(
          { rawResponse: rawText.substring(0, 500) },
          "Failed to parse AI review JSON, falling back to summary-only"
        );
        return {
          summary: rawText.substring(0, 2000),
          comments: [],
          verdict: "COMMENT",
        };
      }

      // Validate and sanitize the parsed result
      const verdict = ["APPROVE", "REQUEST_CHANGES", "COMMENT"].includes(
        parsed.verdict
      )
        ? (parsed.verdict as AIReviewResult["verdict"])
        : "COMMENT";

      const comments: ReviewComment[] = (parsed.comments ?? [])
        .filter(
          (c) =>
            typeof c.path === "string" &&
            typeof c.position === "number" &&
            typeof c.body === "string" &&
            c.position > 0
        )
        .map((c) => ({
          path: c.path,
          position: c.position,
          body: c.body,
        }));

      // Validate that comment paths match actual changed files
      const changedPaths = new Set(files.map((f) => f.filename));
      const validComments = comments.filter((c) => {
        if (!changedPaths.has(c.path)) {
          logger.warn(
            { path: c.path },
            "AI review comment references unknown file, skipping"
          );
          return false;
        }
        return true;
      });

      logger.info(
        {
          prNumber: pr.number,
          verdict,
          commentsCount: validComments.length,
          totalTokens: message.usage.input_tokens + message.usage.output_tokens,
        },
        "AI review complete"
      );

      return {
        summary: parsed.summary || "Review complete.",
        comments: validComments,
        verdict,
      };
    },
  };
}
