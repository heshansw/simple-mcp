import { readdir, stat } from "node:fs/promises";
import { resolve, extname, relative } from "node:path";

import type { Result } from "@shared/result.js";
import { ok, err, validationError, type DomainError } from "@shared/result.js";
import type { AstAnalysisService } from "./ast-analysis.service.js";
import type { HealthScoringService } from "./health-scoring.service.js";
import type {
  FileHealthReport,
  DirectoryHealthReport,
  HealthGrade,
} from "@shared/schemas/code-health.schema.js";
import { ALL_SUPPORTED_EXTENSIONS } from "@shared/schemas/code-health.schema.js";

// ── Types ──────────────────────────────────────────────────────────────

export type CodeHealthDeps = {
  astAnalysis: AstAnalysisService;
  healthScoring: HealthScoringService;
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export type CodeHealthService = {
  analyzeFile(
    filePath: string,
    options?: {
      includePerFunctionMetrics?: boolean;
      includeSuggestions?: boolean;
    },
  ): Promise<Result<FileHealthReport, DomainError>>;

  analyzeDirectory(
    directoryPath: string,
    options?: {
      recursive?: boolean;
      extensions?: ReadonlyArray<string>;
      maxFiles?: number;
      skipPatterns?: ReadonlyArray<string>;
    },
  ): Promise<Result<DirectoryHealthReport, DomainError>>;
};

// ── Default options ────────────────────────────────────────────────────

const DEFAULT_SKIP_PATTERNS: ReadonlyArray<string> = [
  "node_modules",
  "dist",
  ".git",
  "build",
  "coverage",
];

const DEFAULT_MAX_FILES = 200;
const WORST_OFFENDERS_LIMIT = 10;

// ── Factory ────────────────────────────────────────────────────────────

export function createCodeHealthService(deps: CodeHealthDeps): CodeHealthService {
  const { astAnalysis, healthScoring, logger } = deps;

  // ── Helpers ────────────────────────────────────────────────────────

  async function collectFiles(
    dir: string,
    allowedExtensions: ReadonlyArray<string>,
    skipPatterns: ReadonlyArray<string>,
    recursive: boolean,
    collected: string[],
    maxFiles: number,
  ): Promise<void> {
    if (collected.length >= maxFiles) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      logger.error("Failed to read directory", { dir });
      return;
    }

    for (const entry of entries) {
      if (collected.length >= maxFiles) return;

      const fullPath = resolve(dir, entry.name);

      if (entry.isDirectory()) {
        if (skipPatterns.includes(entry.name)) continue;
        if (recursive) {
          await collectFiles(
            fullPath,
            allowedExtensions,
            skipPatterns,
            recursive,
            collected,
            maxFiles,
          );
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (allowedExtensions.includes(ext)) {
          collected.push(fullPath);
        }
      }
    }
  }

  // ── analyzeFile ────────────────────────────────────────────────────

  async function analyzeFile(
    filePath: string,
    options?: {
      includePerFunctionMetrics?: boolean;
      includeSuggestions?: boolean;
    },
  ): Promise<Result<FileHealthReport, DomainError>> {
    const metricsResult = await astAnalysis.analyzeFile(filePath);
    if (metricsResult._tag === "Err") return metricsResult;

    const metrics = metricsResult.value;
    const score = healthScoring.scoreFile(metrics);

    const includePerFunction = options?.includePerFunctionMetrics ?? true;
    const includeSuggestions = options?.includeSuggestions ?? true;

    const report: FileHealthReport = {
      filePath: metrics.filePath,
      language: metrics.language,
      score: includeSuggestions
        ? score
        : { ...score, issues: [] },
      metrics,
      functions: includePerFunction ? metrics.functions : undefined,
    };

    return ok(report);
  }

  // ── analyzeDirectory ───────────────────────────────────────────────

  async function analyzeDirectory(
    directoryPath: string,
    options?: {
      recursive?: boolean;
      extensions?: ReadonlyArray<string>;
      maxFiles?: number;
      skipPatterns?: ReadonlyArray<string>;
    },
  ): Promise<Result<DirectoryHealthReport, DomainError>> {
    const recursive = options?.recursive ?? true;
    const extensions = options?.extensions ?? ALL_SUPPORTED_EXTENSIONS;
    const maxFiles = options?.maxFiles ?? DEFAULT_MAX_FILES;
    const skipPatterns = options?.skipPatterns ?? DEFAULT_SKIP_PATTERNS;

    const resolvedDir = resolve(directoryPath);

    // Verify directory exists
    try {
      const dirStat = await stat(resolvedDir);
      if (!dirStat.isDirectory()) {
        return err(validationError(`Path is not a directory: ${resolvedDir}`));
      }
    } catch {
      return err(validationError(`Directory does not exist: ${resolvedDir}`));
    }

    // Collect files
    const files: string[] = [];
    await collectFiles(resolvedDir, extensions, skipPatterns, recursive, files, maxFiles);

    if (files.length === 0) {
      return err(validationError("No supported files found"));
    }

    logger.info(`Analyzing ${files.length} files in ${resolvedDir}`);

    // Analyze each file sequentially
    const fileReports: FileHealthReport[] = [];
    for (const filePath of files) {
      const result = await analyzeFile(filePath, {
        includePerFunctionMetrics: false,
        includeSuggestions: true,
      });

      if (result._tag === "Err") {
        logger.error(`Skipping file due to analysis failure: ${filePath}`, {
          error: result.error,
        });
        continue;
      }

      fileReports.push(result.value);
    }

    if (fileReports.length === 0) {
      return err(validationError("No supported files found"));
    }

    // Aggregate scores
    const fileScores = fileReports.map((r) => ({
      filePath: r.filePath,
      score: r.score,
    }));
    const { overall, grade } = healthScoring.scoreDirectory(fileScores);

    // Total LOC and functions
    const totalLoc = fileReports.reduce((sum, r) => sum + r.metrics.loc, 0);
    const totalFunctions = fileReports.reduce(
      (sum, r) => sum + r.metrics.functions.length,
      0,
    );

    // Worst offenders — bottom N files by score
    const sorted = [...fileReports].sort(
      (a, b) => a.score.overall - b.score.overall,
    );
    const worstOffenders = sorted.slice(0, WORST_OFFENDERS_LIMIT).map((r) => ({
      filePath: relative(resolvedDir, r.filePath) || r.filePath,
      score: r.score.overall,
      grade: r.score.grade,
      topIssue: r.score.issues[0]?.message,
    }));

    // Distribution histogram
    const distribution: Record<HealthGrade, number> = {
      A: 0,
      B: 0,
      C: 0,
      D: 0,
      F: 0,
    };
    for (const report of fileReports) {
      distribution[report.score.grade] += 1;
    }

    const directoryReport: DirectoryHealthReport = {
      directoryPath: resolvedDir,
      overallScore: overall,
      grade,
      fileCount: fileReports.length,
      totalLoc,
      totalFunctions,
      fileReports,
      worstOffenders,
      distribution,
    };

    return ok(directoryReport);
  }

  return {
    analyzeFile,
    analyzeDirectory,
  };
}
