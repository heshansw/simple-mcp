import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { CodeHealthService } from "../../services/code-health/code-health.service.js";
import type { GitAnalysisService } from "../../services/code-health/git-analysis.service.js";
import { HotspotsInputSchema } from "@shared/schemas/code-health.schema.js";
import type { Hotspot } from "@shared/schemas/code-health.schema.js";

// ── Types ──────────────────────────────────────────────────────────────

export type HotspotsToolDeps = {
  codeHealthService: CodeHealthService;
  gitAnalysis: GitAnalysisService;
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

// ── Weights ────────────────────────────────────────────────────────────

const WEIGHT_HEALTH = 0.4;
const WEIGHT_CHURN = 0.35;
const WEIGHT_BUG_FIX = 0.25;

// ── Registration ───────────────────────────────────────────────────────

export function registerHotspotsTool(
  server: McpServer,
  deps: HotspotsToolDeps,
): void {
  server.tool(
    "code_health_hotspots",
    "Identify code hotspots by combining git change frequency, bug-fix correlation, and code complexity. Files that change often AND have low health are the highest-priority refactoring targets.",
    HotspotsInputSchema.shape,
    async (args) => {
      try {
        const input = HotspotsInputSchema.parse(args);
        deps.logger.info("Computing code hotspots", {
          dir: input.directoryPath,
          lookbackDays: input.lookbackDays,
        });

        // Step 1: Get file churn from git history
        const churnResult = await deps.gitAnalysis.getFileChurn(
          input.directoryPath,
          input.lookbackDays,
        );

        if (isErr(churnResult)) {
          return {
            content: [{ type: "text" as const, text: `Error: ${domainErrorMessage(churnResult.error)}` }],
            isError: true,
          };
        }

        const churnData = churnResult.value;

        if (churnData.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No file changes found in the specified lookback period." }],
          };
        }

        // Step 2: Analyze directory health
        const healthResult = await deps.codeHealthService.analyzeDirectory(
          input.directoryPath,
          { recursive: true },
        );

        if (isErr(healthResult)) {
          return {
            content: [{ type: "text" as const, text: `Error: ${domainErrorMessage(healthResult.error)}` }],
            isError: true,
          };
        }

        const healthReport = healthResult.value;

        // Build a lookup of health scores by file path
        const healthByFile = new Map<string, number>();
        for (const fileReport of healthReport.fileReports) {
          healthByFile.set(fileReport.filePath, fileReport.score.overall);
        }

        // Step 3: Compute hotspot priority for each churned file
        const maxCommitCount = Math.max(...churnData.map((c) => c.commitCount), 1);

        const hotspots: Hotspot[] = [];

        for (const churn of churnData) {
          const healthScore = healthByFile.get(churn.filePath);

          // Skip files we couldn't analyze for health
          if (healthScore === undefined) continue;

          const normalizedHealth = healthScore / 10;
          const normalizedChurn = churn.commitCount / maxCommitCount;
          const normalizedBugFixRatio =
            churn.commitCount > 0
              ? churn.bugFixCommits / churn.commitCount
              : 0;

          const priorityScore =
            (1 - normalizedHealth) * WEIGHT_HEALTH +
            normalizedChurn * WEIGHT_CHURN +
            normalizedBugFixRatio * WEIGHT_BUG_FIX;

          hotspots.push({
            filePath: churn.filePath,
            healthScore,
            churnScore: normalizedChurn,
            bugFixRatio: normalizedBugFixRatio,
            priorityScore: Math.round(priorityScore * 1000) / 1000,
            commitCount: churn.commitCount,
            uniqueAuthors: churn.uniqueAuthors,
          });
        }

        // Step 4: Sort by priority descending, take topN
        hotspots.sort((a, b) => b.priorityScore - a.priorityScore);
        const topHotspots = hotspots.slice(0, input.topN);

        const result = {
          directoryPath: input.directoryPath,
          lookbackDays: input.lookbackDays,
          totalFilesAnalyzed: churnData.length,
          hotspotsFound: topHotspots.length,
          hotspots: topHotspots,
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
