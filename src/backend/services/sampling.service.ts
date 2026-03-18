import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Logger } from "pino";
import type { GitHubPRFile, GitHubPullRequest } from "./github.service.js";

export type SamplingDependencies = {
  readonly server: Server;
  readonly logger: Logger;
};

export type PRReviewResult = {
  readonly summary: string;
  readonly verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  readonly comments: ReadonlyArray<{
    readonly path: string;
    readonly position: number;
    readonly body: string;
  }>;
  readonly rawResponse: string;
};

/**
 * Ask Claude (via MCP sampling) to review a PR diff.
 * Throws if the client does not support sampling or if the request fails.
 */
export async function requestPRReview(
  deps: SamplingDependencies,
  pr: GitHubPullRequest,
  files: GitHubPRFile[]
): Promise<PRReviewResult> {
  const { server, logger } = deps;

  // Build the diff content for Claude to review
  const diffSections = files
    .map((f) => {
      const patchBlock = f.patch
        ? `\`\`\`diff\n${f.patch}\n\`\`\``
        : "_No patch available (binary or too large)_";
      return `### ${f.filename} (${f.status}, +${f.additions} -${f.deletions})\n\n${patchBlock}`;
    })
    .join("\n\n---\n\n");

  const prompt = `You are an expert code reviewer. Review the following GitHub Pull Request and provide detailed, actionable feedback.

## PR Details
- **Title:** ${pr.title}
- **Author:** ${pr.user.login}
- **Branch:** \`${pr.head.ref}\` → \`${pr.base.ref}\`
- **Description:** ${pr.body ?? "_No description provided_"}
- **Files changed:** ${files.length}
- **Total changes:** +${files.reduce((s, f) => s + f.additions, 0)} -${files.reduce((s, f) => s + f.deletions, 0)}

## Diff

${diffSections}

---

## Your Review

Please provide your review in the following JSON format (respond with ONLY the JSON, no markdown wrapper):

{
  "verdict": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  "summary": "<overall review summary — 2-4 sentences describing the PR quality, main concerns, and overall impression>",
  "comments": [
    {
      "path": "<file path exactly as shown above>",
      "position": <line position in the diff hunk (1-based index into the hunk lines, counting from the @@ line)>,
      "body": "<specific, actionable inline comment>"
    }
  ]
}

Guidelines:
- Use "APPROVE" only if the code is production-ready with no blocking issues
- Use "REQUEST_CHANGES" if there are bugs, security issues, or significant quality problems
- Use "COMMENT" for minor suggestions or neutral observations
- For inline comments: only include comments for lines that actually appear in the diff patches above
- Position numbers count from 1 starting at the @@ hunk header line
- If there are no specific inline comments, use an empty array for "comments"
- Be specific and constructive — explain WHY something is a problem and HOW to fix it`;

  logger.info({ prNumber: pr.number, files: files.length }, "Sending PR to Claude for review via sampling");

  const result = await server.createMessage({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: prompt,
        },
      },
    ],
    maxTokens: 4096,
    systemPrompt:
      "You are an expert software engineer performing a code review. Respond only with valid JSON as instructed. Do not wrap the JSON in markdown code blocks.",
  });

  const rawText =
    result.content.type === "text" ? result.content.text : "";

  logger.debug({ rawText }, "Raw sampling response from Claude");

  // Parse the JSON response
  let parsed: {
    verdict: string;
    summary: string;
    comments: Array<{ path: string; position: number; body: string }>;
  };

  try {
    // Strip markdown code fences if Claude wrapped it anyway
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```\s*$/m, "")
      .trim();
    parsed = JSON.parse(cleaned) as typeof parsed;
  } catch (parseError) {
    logger.warn({ rawText, parseError }, "Could not parse Claude sampling response as JSON — using raw as summary");
    return {
      verdict: "COMMENT",
      summary: rawText || "AI review completed.",
      comments: [],
      rawResponse: rawText,
    };
  }

  const allowedVerdicts = ["APPROVE", "REQUEST_CHANGES", "COMMENT"] as const;
  const verdict = allowedVerdicts.includes(
    parsed.verdict as (typeof allowedVerdicts)[number]
  )
    ? (parsed.verdict as "APPROVE" | "REQUEST_CHANGES" | "COMMENT")
    : "COMMENT";

  return {
    verdict,
    summary: parsed.summary ?? "Review completed.",
    comments: Array.isArray(parsed.comments) ? parsed.comments : [],
    rawResponse: rawText,
  };
}

/**
 * Check whether the connected MCP client supports sampling.
 * Returns true if sampling is available, false otherwise.
 */
export function isSamplingSupported(server: Server): boolean {
  // Access client capabilities via the internal _clientCapabilities field.
  // This is set after the client sends its initialize response.
  const caps = (
    server as unknown as { _clientCapabilities?: { sampling?: unknown } }
  )._clientCapabilities;
  return caps?.sampling != null;
}
