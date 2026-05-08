import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { CodeHealthService } from "../../services/code-health/code-health.service.js";
import { AnalyzeDirectoryInputSchema } from "@shared/schemas/code-health.schema.js";

export type AnalyzeDirectoryToolDeps = {
  codeHealthService: CodeHealthService;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

export function registerAnalyzeDirectoryTool(
  server: McpServer,
  deps: AnalyzeDirectoryToolDeps
): void {
  server.tool(
    "code_health_analyze_directory",
    "Analyze code health of all supported files in a directory. Returns aggregate score, per-file scores sorted worst-first, grade distribution, and worst offenders list. Supports TS/JS/Java.",
    AnalyzeDirectoryInputSchema.shape,
    async (args) => {
      try {
        const input = AnalyzeDirectoryInputSchema.parse(args);
        deps.logger.info("Analyzing directory health", { dir: input.directoryPath });

        const result = await deps.codeHealthService.analyzeDirectory(input.directoryPath, {
          recursive: input.recursive,
          extensions: input.extensions,
          maxFiles: input.maxFiles,
          skipPatterns: input.skipPatterns,
        });

        if (isErr(result)) {
          return { content: [{ type: "text" as const, text: `Error: ${domainErrorMessage(result.error)}` }], isError: true };
        }

        // Return a summary rather than full report if too large
        const report = result.value;
        const summary = {
          directoryPath: report.directoryPath,
          overallScore: report.overallScore,
          grade: report.grade,
          fileCount: report.fileCount,
          totalLoc: report.totalLoc,
          totalFunctions: report.totalFunctions,
          distribution: report.distribution,
          worstOffenders: report.worstOffenders,
          files: report.fileReports.map(f => ({
            filePath: f.filePath,
            score: f.score.overall,
            grade: f.score.grade,
            issueCount: f.score.issues.length,
          })),
        };

        return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
