import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import { PreCommitCheckInputSchema } from "@shared/schemas/code-health.schema.js";
import type { HealthIssue } from "@shared/schemas/code-health.schema.js";
import type { CodeHealthService } from "../../services/code-health/code-health.service.js";
import type { CodeHealthSnapshotsRepository } from "../../db/repositories/code-health-snapshots.repository.js";
import type { CodeHealthEventsRepository } from "../../db/repositories/code-health-events.repository.js";

export type PreCommitCheckToolDeps = {
  codeHealthService: CodeHealthService;
  snapshotsRepo: CodeHealthSnapshotsRepository;
  eventsRepo: CodeHealthEventsRepository;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

type FileVerdict = {
  filePath: string;
  beforeScore: number | undefined;
  currentScore: number;
  regression: number | undefined;
  pass: boolean;
};

export function registerPreCommitCheckTool(server: McpServer, deps: PreCommitCheckToolDeps): void {
  server.tool(
    "code_health_pre_commit_check",
    "Quality gate for code changes. Analyzes specified files against baseline, returns pass/fail with blocking issues and fix suggestions. Use for self-correcting loops.",
    PreCommitCheckInputSchema.shape,
    async (args) => {
      try {
        const input = PreCommitCheckInputSchema.parse(args);
        const { directoryPath, filePaths, maxAllowedRegression, requireMinScore } = input;

        deps.logger.info("Running pre-commit check", {
          directoryPath,
          fileCount: filePaths.length,
          maxAllowedRegression,
          requireMinScore,
        });

        // 1. Find latest snapshot for baseline scores
        const latestSnapshot = await deps.snapshotsRepo.findLatest(directoryPath);
        const baselineOverallScore = latestSnapshot?.overallScore ?? undefined;

        // 2. Analyze each file
        const fileVerdicts: FileVerdict[] = [];
        const blockingIssues: HealthIssue[] = [];
        const suggestions: HealthIssue[] = [];

        for (const filePath of filePaths) {
          const result = await deps.codeHealthService.analyzeFile(filePath, {
            includeSuggestions: true,
            includePerFunctionMetrics: false,
          });

          if (isErr(result)) {
            deps.logger.error("Failed to analyze file for pre-commit check", {
              filePath,
              error: domainErrorMessage(result.error),
            });
            // Treat analysis failure as a failing file
            fileVerdicts.push({
              filePath,
              beforeScore: baselineOverallScore,
              currentScore: 0,
              regression: baselineOverallScore !== undefined ? baselineOverallScore : undefined,
              pass: false,
            });
            blockingIssues.push({
              severity: "critical",
              signal: "analysis_failure",
              message: `Could not analyze file: ${domainErrorMessage(result.error)}`,
              filePath,
            });
            continue;
          }

          const report = result.value;
          const currentScore = report.score.overall;

          // Use snapshot overall score as a baseline reference per file
          // since we don't have per-file baseline without the file metrics repo
          const beforeScore = baselineOverallScore;
          const regression = beforeScore !== undefined ? beforeScore - currentScore : undefined;

          // Determine pass/fail
          let pass = true;

          // Check regression threshold
          if (regression !== undefined && regression > maxAllowedRegression) {
            pass = false;
            blockingIssues.push({
              severity: "critical",
              signal: "regression",
              message: `Score regression of ${regression.toFixed(2)} exceeds threshold of ${maxAllowedRegression}`,
              filePath,
            });
          }

          // Check minimum score requirement
          if (requireMinScore !== undefined && currentScore < requireMinScore) {
            pass = false;
            blockingIssues.push({
              severity: "critical",
              signal: "below_minimum",
              message: `Score ${currentScore.toFixed(2)} is below minimum required score of ${requireMinScore}`,
              filePath,
            });
          }

          fileVerdicts.push({
            filePath,
            beforeScore,
            currentScore,
            regression,
            pass,
          });

          // Collect suggestions from non-passing files (or all files with issues)
          for (const issue of report.score.issues) {
            if (!pass && (issue.severity === "critical" || issue.severity === "warning")) {
              suggestions.push(issue);
            } else if (issue.severity === "critical") {
              suggestions.push(issue);
            }
          }
        }

        const overallPass = fileVerdicts.every((v) => v.pass);

        // 3. Log event
        await deps.eventsRepo.create({
          eventType: "pre_commit_check",
          filePath: directoryPath,
          beforeScore: baselineOverallScore ?? null,
          afterScore: fileVerdicts.length > 0
            ? fileVerdicts.reduce((sum, v) => sum + v.currentScore, 0) / fileVerdicts.length
            : null,
          issuesFound: blockingIssues.length,
          issuesResolved: 0,
          iterations: 0,
          trigger: "pre_commit",
          contextJson: JSON.stringify({
            filesChecked: filePaths.length,
            overallPass,
            maxAllowedRegression,
            requireMinScore,
          }),
        });

        const response = {
          pass: overallPass,
          filesChecked: fileVerdicts.length,
          fileVerdicts,
          blockingIssues,
          suggestions,
        };

        deps.logger.info("Pre-commit check complete", {
          pass: overallPass,
          filesChecked: fileVerdicts.length,
          blockingIssues: blockingIssues.length,
        });

        return { content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
