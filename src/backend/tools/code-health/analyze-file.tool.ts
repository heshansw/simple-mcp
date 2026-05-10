import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, isOk, domainErrorMessage } from "@shared/result.js";
import type { CodeHealthService } from "../../services/code-health/code-health.service.js";
import type { CodeHealthBackgroundJobsRepository } from "../../db/repositories/code-health-background-jobs.repository.js";
import type { AiCodeReviewService } from "../../services/code-health/ai-code-review.service.js";
import { AnalyzeFileInputSchema, scoreToGrade } from "@shared/schemas/code-health.schema.js";

export type AnalyzeFileToolDeps = {
  codeHealthService: CodeHealthService;
  backgroundJobsRepo?: CodeHealthBackgroundJobsRepository;
  aiCodeReviewService?: AiCodeReviewService;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

export function registerAnalyzeFileTool(
  server: McpServer,
  deps: AnalyzeFileToolDeps
): void {
  server.tool(
    "code_health_analyze_file",
    "Analyze a single file's code health. Returns a 1-10 score with 7-signal breakdown (complexity, maintainability, duplication, function size, type safety, nesting depth, parameter count), per-function metrics, and improvement suggestions with line numbers.",
    AnalyzeFileInputSchema.shape,
    async (args) => {
      try {
        const input = AnalyzeFileInputSchema.parse(args);
        deps.logger.info("Analyzing file health", { filePath: input.filePath });

        const result = await deps.codeHealthService.analyzeFile(input.filePath, {
          includePerFunctionMetrics: input.includePerFunctionMetrics,
          includeSuggestions: input.includeSuggestions,
        });

        if (isErr(result)) {
          return { content: [{ type: "text" as const, text: `Error: ${domainErrorMessage(result.error)}` }], isError: true };
        }

        let finalReport = result.value;

        // AI Review (optional)
        if (input.aiReview && deps.aiCodeReviewService) {
          try {
            const { readFile } = await import("node:fs/promises");
            const source = await readFile(input.filePath, "utf-8");
            const aiResult = await deps.aiCodeReviewService.reviewFile(
              input.filePath,
              source,
              finalReport.language,
              finalReport.metrics,
              finalReport.score,
            );
            if (aiResult._tag === "Ok") {
              const blendedScore = Math.round((finalReport.score.overall * 0.7 + aiResult.value.aiScore * 0.3) * 100) / 100;
              finalReport = {
                ...finalReport,
                score: {
                  ...finalReport.score,
                  overall: blendedScore,
                  grade: scoreToGrade(blendedScore),
                  issues: [...finalReport.score.issues, ...aiResult.value.issues],
                },
                aiReviewResult: {
                  ...aiResult.value,
                  issues: [...aiResult.value.issues],
                },
              };
            } else {
              deps.logger.info("AI review skipped", { reason: aiResult.error });
            }
          } catch (aiError) {
            deps.logger.info("AI review error, using static-only", { error: String(aiError) });
          }
        }

        // Persist result to background jobs for UI visibility
        if (deps.backgroundJobsRepo && isOk(result)) {
          deps.backgroundJobsRepo.create({
            filePath: input.filePath,
            status: "completed",
            score: finalReport.score.overall,
            grade: finalReport.score.grade,
            issueCount: finalReport.score.issues.length,
            issuesJson: JSON.stringify(finalReport.score.issues),
            aiScore: finalReport.aiReviewResult?.aiScore ?? null,
            aiReviewJson: finalReport.aiReviewResult ? JSON.stringify(finalReport.aiReviewResult) : null,
            triggerTool: "code_health_analyze_file",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          }).catch((err) => {
            deps.logger.error("Failed to persist analysis result", { error: String(err) });
          });
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(finalReport, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
