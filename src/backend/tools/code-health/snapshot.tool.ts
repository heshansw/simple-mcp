import { execSync } from "node:child_process";
import { relative } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import { SnapshotInputSchema } from "@shared/schemas/code-health.schema.js";
import type { CodeHealthService } from "../../services/code-health/code-health.service.js";
import type { CodeHealthSnapshotsRepository } from "../../db/repositories/code-health-snapshots.repository.js";
import type { CodeHealthFileMetricsRepository } from "../../db/repositories/code-health-file-metrics.repository.js";
import type { CodeHealthFunctionMetricsRepository } from "../../db/repositories/code-health-function-metrics.repository.js";

export type SnapshotToolDeps = {
  codeHealthService: CodeHealthService;
  snapshotsRepo: CodeHealthSnapshotsRepository;
  fileMetricsRepo: CodeHealthFileMetricsRepository;
  functionMetricsRepo: CodeHealthFunctionMetricsRepository;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

export function registerSnapshotTool(server: McpServer, deps: SnapshotToolDeps): void {
  server.tool(
    "code_health_snapshot",
    "Take a full project health snapshot and persist to database. Establishes baselines for trend tracking. Returns snapshot ID, aggregate score, file count, and comparison with previous snapshot.",
    SnapshotInputSchema.shape,
    async (args) => {
      try {
        const input = SnapshotInputSchema.parse(args);
        const { directoryPath, extensions, skipPatterns, label, workspaceId } = input;

        deps.logger.info("Taking code health snapshot", { directoryPath, label });

        // 1. Analyze directory
        const analysisResult = await deps.codeHealthService.analyzeDirectory(directoryPath, {
          extensions,
          skipPatterns,
        });

        if (isErr(analysisResult)) {
          return {
            content: [{ type: "text" as const, text: `Error: ${domainErrorMessage(analysisResult.error)}` }],
            isError: true,
          };
        }

        const report = analysisResult.value;

        // 2. Resolve git ref
        let gitRef: string | null = null;
        try {
          gitRef = execSync("git rev-parse HEAD", { cwd: directoryPath, encoding: "utf-8" }).trim();
        } catch {
          deps.logger.info("Could not resolve git ref — not a git repository or git not available");
        }

        // 3. Compute aggregate metrics for snapshot record
        const allFunctions = report.fileReports.flatMap((f) => f.metrics.functions);
        const avgCyclomatic =
          allFunctions.length > 0
            ? allFunctions.reduce((sum, fn) => sum + fn.cyclomatic, 0) / allFunctions.length
            : 0;
        const avgCognitive =
          allFunctions.length > 0
            ? allFunctions.reduce((sum, fn) => sum + fn.cognitive, 0) / allFunctions.length
            : 0;

        // 4. Create snapshot record
        const snapshot = await deps.snapshotsRepo.create({
          directoryPath: report.directoryPath,
          workspaceId: workspaceId ?? null,
          label: label ?? null,
          overallScore: report.overallScore,
          grade: report.grade,
          fileCount: report.fileCount,
          totalLoc: report.totalLoc,
          totalFunctions: report.totalFunctions,
          avgCyclomatic,
          avgCognitive,
          duplicationPct: 0,
          typeCoveragePct: null,
          configJson: JSON.stringify({ extensions, skipPatterns }),
          gitRef,
        });

        // 5. Create file metric records and collect IDs for function metrics
        for (const fileReport of report.fileReports) {
          const fileMetric = await deps.fileMetricsRepo.create({
            snapshotId: snapshot.id,
            filePath: fileReport.filePath,
            relativePath: relative(report.directoryPath, fileReport.filePath) || fileReport.filePath,
            language: fileReport.language,
            score: fileReport.score.overall,
            grade: fileReport.score.grade,
            loc: fileReport.metrics.loc,
            slocLogical: fileReport.metrics.slocLogical,
            functionCount: fileReport.metrics.functions.length,
            avgCyclomatic: fileReport.metrics.averageCyclomatic,
            maxCyclomatic: fileReport.metrics.maxCyclomatic,
            avgCognitive: fileReport.metrics.averageCognitive,
            maxCognitive: fileReport.metrics.maxCognitive,
            maintainabilityIndex: fileReport.metrics.maintainabilityIndex,
            duplicationLines: 0,
            typeCoveragePct: null,
            anyCount: 0,
            nestingDepthMax: fileReport.metrics.functions.reduce(
              (max, fn) => Math.max(max, fn.nestingDepth),
              0,
            ),
            issuesJson: JSON.stringify(fileReport.score.issues),
          });

          // 6. Create function metric records
          const functionRows = fileReport.metrics.functions.map((fn) => ({
            fileMetricId: fileMetric.id,
            functionName: fn.name,
            startLine: fn.startLine,
            endLine: fn.endLine,
            loc: fn.loc,
            parameterCount: fn.parameterCount,
            cyclomatic: fn.cyclomatic,
            cognitive: fn.cognitive,
            halsteadEffort: fn.halstead.effort,
            halsteadDifficulty: fn.halstead.difficulty,
            halsteadVolume: fn.halstead.volume,
            nestingDepth: fn.nestingDepth,
          }));

          if (functionRows.length > 0) {
            await deps.functionMetricsRepo.createMany(functionRows);
          }
        }

        // 7. Find previous snapshot for comparison
        const allSnapshots = await deps.snapshotsRepo.findByDirectory(directoryPath, 2);
        const previousSnapshot = allSnapshots.find((s) => s.id !== snapshot.id);

        const previousScore = previousSnapshot?.overallScore ?? null;
        const scoreDelta = previousScore !== null ? snapshot.overallScore - previousScore : null;

        const result = {
          snapshotId: snapshot.id,
          overallScore: snapshot.overallScore,
          grade: snapshot.grade,
          fileCount: snapshot.fileCount,
          totalLoc: snapshot.totalLoc,
          totalFunctions: snapshot.totalFunctions,
          gitRef,
          label: snapshot.label,
          previousScore,
          scoreDelta,
          previousGrade: previousSnapshot ? previousSnapshot.grade : null,
        };

        deps.logger.info("Snapshot created", { snapshotId: snapshot.id, score: snapshot.overallScore });

        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
