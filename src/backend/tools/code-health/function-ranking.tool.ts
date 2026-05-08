import { stat } from "node:fs/promises";
import { extname } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { CodeHealthService } from "../../services/code-health/code-health.service.js";
import {
  FunctionRankingInputSchema,
  ALL_SUPPORTED_EXTENSIONS,
} from "@shared/schemas/code-health.schema.js";
import type { FunctionMetrics } from "@shared/schemas/code-health.schema.js";

// ── Types ──────────────────────────────────────────────────────────────

export type FunctionRankingToolDeps = {
  codeHealthService: CodeHealthService;
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

type RankedFunction = FunctionMetrics & {
  filePath: string;
  sortValue: number;
};

// ── Metric extraction ──────────────────────────────────────────────────

const SORT_BY_FIELD_MAP = {
  cyclomatic: (f: FunctionMetrics) => f.cyclomatic,
  cognitive: (f: FunctionMetrics) => f.cognitive,
  halstead_effort: (f: FunctionMetrics) => f.halstead.effort,
  loc: (f: FunctionMetrics) => f.loc,
  parameter_count: (f: FunctionMetrics) => f.parameterCount,
} as const;

// ── Registration ───────────────────────────────────────────────────────

export function registerFunctionRankingTool(
  server: McpServer,
  deps: FunctionRankingToolDeps,
): void {
  server.tool(
    "code_health_function_ranking",
    "Rank all functions in a file or directory by any complexity metric. Identifies the most problematic functions as refactoring candidates.",
    FunctionRankingInputSchema.shape,
    async (args) => {
      try {
        const input = FunctionRankingInputSchema.parse(args);
        deps.logger.info("Ranking functions by complexity", {
          targetPath: input.targetPath,
          sortBy: input.sortBy,
        });

        const getMetricValue = SORT_BY_FIELD_MAP[input.sortBy];
        const ranked: RankedFunction[] = [];

        // Determine if targetPath is a file or directory
        const targetStat = await stat(input.targetPath);
        const isFile =
          targetStat.isFile() &&
          ALL_SUPPORTED_EXTENSIONS.includes(extname(input.targetPath));

        if (isFile) {
          // Analyze single file
          const result = await deps.codeHealthService.analyzeFile(
            input.targetPath,
            { includePerFunctionMetrics: true, includeSuggestions: false },
          );

          if (isErr(result)) {
            return {
              content: [{ type: "text" as const, text: `Error: ${domainErrorMessage(result.error)}` }],
              isError: true,
            };
          }

          for (const fn of result.value.metrics.functions) {
            ranked.push({
              ...fn,
              filePath: input.targetPath,
              sortValue: getMetricValue(fn),
            });
          }
        } else if (targetStat.isDirectory()) {
          // Analyze entire directory
          const result = await deps.codeHealthService.analyzeDirectory(
            input.targetPath,
            { recursive: true },
          );

          if (isErr(result)) {
            return {
              content: [{ type: "text" as const, text: `Error: ${domainErrorMessage(result.error)}` }],
              isError: true,
            };
          }

          for (const fileReport of result.value.fileReports) {
            for (const fn of fileReport.metrics.functions) {
              ranked.push({
                ...fn,
                filePath: fileReport.filePath,
                sortValue: getMetricValue(fn),
              });
            }
          }
        } else {
          return {
            content: [{ type: "text" as const, text: `Error: Target path is neither a supported file nor a directory: ${input.targetPath}` }],
            isError: true,
          };
        }

        // Sort descending by chosen metric
        ranked.sort((a, b) => b.sortValue - a.sortValue);

        // Apply minimum threshold filter
        const filtered =
          input.minThreshold !== undefined
            ? ranked.filter((f) => f.sortValue >= input.minThreshold!)
            : ranked;

        // Limit results
        const limited = filtered.slice(0, input.limit);

        const result = {
          targetPath: input.targetPath,
          sortBy: input.sortBy,
          totalFunctionsFound: ranked.length,
          returnedCount: limited.length,
          functions: limited.map((f) => ({
            filePath: f.filePath,
            functionName: f.name,
            startLine: f.startLine,
            endLine: f.endLine,
            loc: f.loc,
            parameterCount: f.parameterCount,
            cyclomatic: f.cyclomatic,
            cognitive: f.cognitive,
            halsteadEffort: f.halstead.effort,
            nestingDepth: f.nestingDepth,
            sortValue: f.sortValue,
          })),
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
