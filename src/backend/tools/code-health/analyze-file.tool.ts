import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, isOk, domainErrorMessage } from "@shared/result.js";
import type { CodeHealthService } from "../../services/code-health/code-health.service.js";
import type { CodeHealthBackgroundJobsRepository } from "../../db/repositories/code-health-background-jobs.repository.js";
import { AnalyzeFileInputSchema } from "@shared/schemas/code-health.schema.js";

export type AnalyzeFileToolDeps = {
  codeHealthService: CodeHealthService;
  backgroundJobsRepo?: CodeHealthBackgroundJobsRepository;
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

        // Persist result to background jobs for UI visibility
        if (deps.backgroundJobsRepo && isOk(result)) {
          const report = result.value;
          deps.backgroundJobsRepo.create({
            filePath: input.filePath,
            status: "completed",
            score: report.score.overall,
            grade: report.score.grade,
            issueCount: report.score.issues.length,
            issuesJson: JSON.stringify(report.score.issues),
            triggerTool: "code_health_analyze_file",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          }).catch((err) => {
            deps.logger.error("Failed to persist analysis result", { error: String(err) });
          });
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
