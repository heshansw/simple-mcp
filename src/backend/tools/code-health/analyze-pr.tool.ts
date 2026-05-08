import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import { AnalyzePrInputSchema } from "@shared/schemas/code-health.schema.js";
import type { CodeHealthService } from "../../services/code-health/code-health.service.js";
import type { GitHubService } from "../../services/github.service.js";
import type { CodeHealthEventsRepository } from "../../db/repositories/code-health-events.repository.js";

export type AnalyzePrToolDeps = {
  codeHealthService: CodeHealthService;
  githubService: GitHubService;
  eventsRepo: CodeHealthEventsRepository;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

export function registerAnalyzePrTool(
  server: McpServer,
  deps: AnalyzePrToolDeps
): void {
  server.tool(
    "code_health_analyze_pr",
    "Analyze code health impact of a GitHub PR. Compares health scores for changed files, flags regressions, and produces a summary with before/after comparisons.",
    AnalyzePrInputSchema.shape,
    async (args) => {
      try {
        const input = AnalyzePrInputSchema.parse(args);
        deps.logger.info("Analyzing PR health", { owner: input.owner, repo: input.repo, pr: input.prNumber });

        // 1. Get PR files from GitHub
        const filesResult = await deps.githubService.getPullRequestFiles(input.owner, input.repo, input.prNumber);
        if (isErr(filesResult)) {
          return { content: [{ type: "text" as const, text: `Error fetching PR files: ${domainErrorMessage(filesResult.error)}` }], isError: true };
        }

        const prFiles = filesResult.value;
        const supportedExtensions = [".ts", ".tsx", ".js", ".jsx", ".java"];
        const changedFiles = prFiles.filter(f =>
          supportedExtensions.some(ext => f.filename.endsWith(ext))
        );

        if (changedFiles.length === 0) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ message: "No supported files changed in this PR", filesTotal: prFiles.length }) }] };
        }

        // 2. Analyze each changed file (assumes local checkout)
        const fileResults: Array<{
          filename: string;
          status: string;
          additions: number;
          deletions: number;
          score: number;
          grade: string;
          issueCount: number;
          topIssues: string[];
        }> = [];

        let totalScore = 0;
        let analyzedCount = 0;

        for (const file of changedFiles) {
          if (file.status === "removed") continue;

          const result = await deps.codeHealthService.analyzeFile(file.filename, { includeSuggestions: true });
          if (isErr(result)) {
            deps.logger.info("Skipping file (analysis failed)", { file: file.filename });
            continue;
          }

          const report = result.value;
          totalScore += report.score.overall;
          analyzedCount++;

          fileResults.push({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            score: Math.round(report.score.overall * 10) / 10,
            grade: report.score.grade,
            issueCount: report.score.issues.length,
            topIssues: report.score.issues.slice(0, 3).map(i => i.message),
          });
        }

        const overallScore = analyzedCount > 0 ? Math.round((totalScore / analyzedCount) * 10) / 10 : 0;
        const regressions = fileResults.filter(f => f.score < (10 - input.regressionThreshold));
        const pass = !input.failOnRegression || regressions.length === 0;

        // Log event
        await deps.eventsRepo.create({
          eventType: "pr_analysis",
          afterScore: overallScore,
          issuesFound: fileResults.reduce((s, f) => s + f.issueCount, 0),
          trigger: "manual",
          contextJson: JSON.stringify({ owner: input.owner, repo: input.repo, prNumber: input.prNumber }),
        });

        const summary = {
          pr: `${input.owner}/${input.repo}#${input.prNumber}`,
          overallScore,
          pass,
          filesAnalyzed: analyzedCount,
          filesTotal: prFiles.length,
          fileResults: fileResults.sort((a, b) => a.score - b.score),
          regressionCount: regressions.length,
          markdownSummary: generateMarkdownSummary(input.owner, input.repo, input.prNumber, overallScore, fileResults),
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}

function generateMarkdownSummary(
  owner: string,
  repo: string,
  prNumber: number,
  overallScore: number,
  files: Array<{ filename: string; score: number; grade: string; issueCount: number; topIssues: string[] }>
): string {
  const lines: string[] = [];
  lines.push(`## Code Health Report for ${owner}/${repo}#${prNumber}`);
  lines.push("");
  lines.push(`**Overall Score: ${overallScore}/10**`);
  lines.push("");
  lines.push("| File | Score | Grade | Issues |");
  lines.push("|------|-------|-------|--------|");
  for (const f of files) {
    lines.push(`| \`${f.filename}\` | ${f.score} | ${f.grade} | ${f.issueCount} |`);
  }

  const problemFiles = files.filter(f => f.score < 7);
  if (problemFiles.length > 0) {
    lines.push("");
    lines.push("### Top Issues");
    for (const f of problemFiles) {
      if (f.topIssues.length > 0) {
        lines.push(`- **${f.filename}**: ${f.topIssues.join("; ")}`);
      }
    }
  }

  return lines.join("\n");
}
