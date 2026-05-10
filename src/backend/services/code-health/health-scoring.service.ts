import type {
  HealthScore,
  SignalBreakdown,
  HealthGrade,
  HealthIssue,
  FileAstMetrics,
  SupportedLanguage,
} from "@shared/schemas/code-health.schema.js";
import {
  SIGNAL_WEIGHTS,
  SIGNAL_WEIGHTS_NO_TYPES,
  scoreToGrade,
} from "@shared/schemas/code-health.schema.js";

// ── Types ────────────────────────────────────────────────────────────────

export type HealthScoringDeps = {
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export type HealthScoringService = {
  scoreFile(
    metrics: FileAstMetrics,
    options?: {
      duplicationPercentage?: number;
      typeCoveragePercentage?: number;
      anyCount?: number;
    },
  ): HealthScore;

  scoreDirectory(
    fileScores: ReadonlyArray<{ filePath: string; score: HealthScore }>,
  ): { overall: number; grade: HealthGrade };
};

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Piecewise linear interpolation between two thresholds.
 * Returns 10 when `value <= bestThreshold`, 1 when `value >= worstThreshold`,
 * and linearly interpolates between.
 */
function linearInterpolate(
  value: number,
  bestThreshold: number,
  worstThreshold: number,
): number {
  if (value <= bestThreshold) return 10;
  if (value >= worstThreshold) return 1;
  // Linear interpolation: score goes from 10 (at best) to 1 (at worst)
  const ratio = (value - bestThreshold) / (worstThreshold - bestThreshold);
  return 10 - ratio * 9;
}

/**
 * Inverted interpolation for metrics where higher raw values are better
 * (e.g. maintainability index, type coverage).
 * Returns 10 when `value >= bestThreshold`, 1 when `value <= worstThreshold`.
 */
function linearInterpolateInverted(
  value: number,
  bestThreshold: number,
  worstThreshold: number,
): number {
  if (value >= bestThreshold) return 10;
  if (value <= worstThreshold) return 1;
  const ratio = (value - worstThreshold) / (bestThreshold - worstThreshold);
  return 1 + ratio * 9;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

type SignalWeights = Record<keyof typeof SIGNAL_WEIGHTS, number>;

function selectWeights(language: SupportedLanguage): SignalWeights {
  return language === "typescript" ? SIGNAL_WEIGHTS : SIGNAL_WEIGHTS_NO_TYPES;
}

// ── Signal Computation ───────────────────────────────────────────────────

function computeCodeSmellsScore(metrics: FileAstMetrics): number {
  const smells = metrics.codeSmells;
  if (!smells) return 10;

  let score = 10;
  score -= Math.min(smells.consoleStatements * 0.5, 3);
  score -= Math.min(smells.todoFixmeCount * 0.3, 2);
  score -= Math.min(smells.magicNumberCount * 0.2, 2);
  if (smells.isGodFile) score -= 2;

  return clamp(score, 1, 10);
}

function computeBreakdown(
  metrics: FileAstMetrics,
  options: {
    duplicationPercentage: number;
    typeCoveragePercentage: number;
  },
): SignalBreakdown {
  const avgFunctionLoc =
    metrics.functions.length > 0
      ? metrics.functions.reduce((sum, fn) => sum + fn.loc, 0) /
        metrics.functions.length
      : 0;

  const maxNesting =
    metrics.functions.length > 0
      ? Math.max(...metrics.functions.map((fn) => fn.nestingDepth))
      : 0;

  const avgParams =
    metrics.functions.length > 0
      ? metrics.functions.reduce((sum, fn) => sum + fn.parameterCount, 0) /
        metrics.functions.length
      : 0;

  const isTypescript = metrics.language === "typescript";

  return {
    complexity: round2(
      linearInterpolate(metrics.averageCyclomatic, 1, 15),
    ),
    maintainability: round2(
      linearInterpolateInverted(metrics.maintainabilityIndex, 100, 40),
    ),
    duplication: round2(
      linearInterpolate(options.duplicationPercentage, 0, 20),
    ),
    functionSize: round2(linearInterpolate(avgFunctionLoc, 8, 50)),
    typeSafety: isTypescript
      ? round2(
          linearInterpolateInverted(options.typeCoveragePercentage, 100, 50),
        )
      : 10,
    nestingDepth: round2(linearInterpolate(maxNesting, 1, 5)),
    parameterCount: round2(linearInterpolate(avgParams, 1, 5)),
    codeSmells: round2(computeCodeSmellsScore(metrics)),
  };
}

function computeOverall(
  breakdown: SignalBreakdown,
  weights: SignalWeights,
): number {
  const raw =
    breakdown.complexity * weights.complexity +
    breakdown.maintainability * weights.maintainability +
    breakdown.duplication * weights.duplication +
    breakdown.functionSize * weights.functionSize +
    breakdown.typeSafety * weights.typeSafety +
    breakdown.nestingDepth * weights.nestingDepth +
    breakdown.parameterCount * weights.parameterCount +
    breakdown.codeSmells * weights.codeSmells;

  return round2(clamp(raw, 1, 10));
}

// ── Issue Generation ─────────────────────────────────────────────────────

type IssueSeverity = HealthIssue["severity"];

function severityForScore(score: number): IssueSeverity | null {
  if (score < 4) return "critical";
  if (score < 6) return "warning";
  if (score < 8) return "info";
  return null;
}

const SIGNAL_SUGGESTIONS: Record<keyof SignalBreakdown, string> = {
  complexity: "Consider breaking this function into smaller pieces",
  maintainability: "Reduce complexity and improve code structure",
  duplication: "Extract duplicated code into shared functions",
  functionSize: "", // dynamically generated with avg LOC
  typeSafety: "Increase type coverage and remove implicit any types",
  nestingDepth:
    "Reduce nesting depth by using early returns or extracting helper functions",
  parameterCount:
    "Consider using an options object instead of multiple parameters",
  codeSmells:
    "Address code smells: remove console statements, resolve TODOs, extract magic numbers into named constants",
};

function generateSignalIssues(
  breakdown: SignalBreakdown,
  metrics: FileAstMetrics,
): HealthIssue[] {
  const issues: HealthIssue[] = [];

  for (const [signal, score] of Object.entries(breakdown) as Array<
    [keyof SignalBreakdown, number]
  >) {
    const severity = severityForScore(score);
    if (severity === null) continue;

    let suggestion = SIGNAL_SUGGESTIONS[signal];

    if (signal === "functionSize") {
      const avgLoc =
        metrics.functions.length > 0
          ? Math.round(
              metrics.functions.reduce((sum, fn) => sum + fn.loc, 0) /
                metrics.functions.length,
            )
          : 0;
      suggestion = `Split large functions (avg ${avgLoc} lines) into smaller, focused functions`;
    }

    issues.push({
      severity,
      signal,
      message: `${String(signal)} score is ${score}/10`,
      filePath: metrics.filePath,
      suggestion,
    });
  }

  return issues;
}

function generatePerFunctionIssues(metrics: FileAstMetrics): HealthIssue[] {
  const issues: HealthIssue[] = [];

  for (const fn of metrics.functions) {
    // Cyclomatic complexity
    if (fn.cyclomatic > 15) {
      issues.push({
        severity: "critical",
        signal: "complexity",
        message: `Function "${fn.name}" has cyclomatic complexity of ${fn.cyclomatic}`,
        filePath: metrics.filePath,
        line: fn.startLine,
        functionName: fn.name,
        suggestion: "Consider breaking this function into smaller pieces",
      });
    } else if (fn.cyclomatic > 8) {
      issues.push({
        severity: "warning",
        signal: "complexity",
        message: `Function "${fn.name}" has cyclomatic complexity of ${fn.cyclomatic}`,
        filePath: metrics.filePath,
        line: fn.startLine,
        functionName: fn.name,
        suggestion: "Consider breaking this function into smaller pieces",
      });
    }

    // Function size (LOC)
    if (fn.loc > 60) {
      issues.push({
        severity: "critical",
        signal: "functionSize",
        message: `Function "${fn.name}" is ${fn.loc} lines long`,
        filePath: metrics.filePath,
        line: fn.startLine,
        functionName: fn.name,
        suggestion:
          "Split large functions into smaller, focused functions",
      });
    } else if (fn.loc > 30) {
      issues.push({
        severity: "warning",
        signal: "functionSize",
        message: `Function "${fn.name}" is ${fn.loc} lines long`,
        filePath: metrics.filePath,
        line: fn.startLine,
        functionName: fn.name,
        suggestion:
          "Split large functions into smaller, focused functions",
      });
    }

    // Nesting depth
    if (fn.nestingDepth > 3) {
      issues.push({
        severity: "warning",
        signal: "nestingDepth",
        message: `Function "${fn.name}" has nesting depth of ${fn.nestingDepth}`,
        filePath: metrics.filePath,
        line: fn.startLine,
        functionName: fn.name,
        suggestion:
          "Reduce nesting depth by using early returns or extracting helper functions",
      });
    }

    // Parameter count
    if (fn.parameterCount > 3) {
      issues.push({
        severity: "warning",
        signal: "parameterCount",
        message: `Function "${fn.name}" has ${fn.parameterCount} parameters`,
        filePath: metrics.filePath,
        line: fn.startLine,
        functionName: fn.name,
        suggestion:
          "Consider using an options object instead of multiple parameters",
      });
    }
  }

  return issues;
}

function generateCodeSmellIssues(metrics: FileAstMetrics): HealthIssue[] {
  const smells = metrics.codeSmells;
  if (!smells) return [];

  const issues: HealthIssue[] = [];

  if (smells.consoleStatements > 0) {
    issues.push({
      severity: "warning",
      signal: "codeSmells",
      message: `${smells.consoleStatements} console statement(s) found`,
      filePath: metrics.filePath,
      suggestion: "Remove console statements or replace with a proper logger",
    });
  }

  if (smells.todoFixmeCount > 0) {
    issues.push({
      severity: "info",
      signal: "codeSmells",
      message: `${smells.todoFixmeCount} TODO/FIXME comment(s) found`,
      filePath: metrics.filePath,
      suggestion: "Resolve TODO/FIXME comments or convert them to tracked issues",
    });
  }

  if (smells.isGodFile) {
    issues.push({
      severity: "warning",
      signal: "codeSmells",
      message: "File detected as a god file (too many responsibilities)",
      filePath: metrics.filePath,
      suggestion: "Split this file into smaller, focused modules",
    });
  }

  if (smells.magicNumberCount > 5) {
    issues.push({
      severity: "warning",
      signal: "codeSmells",
      message: `${smells.magicNumberCount} magic number(s) found`,
      filePath: metrics.filePath,
      suggestion: "Extract magic numbers into named constants",
    });
  }

  return issues;
}

// ── Factory ──────────────────────────────────────────────────────────────

export function createHealthScoringService(
  deps: HealthScoringDeps,
): HealthScoringService {
  return {
    scoreFile(metrics, options) {
      const duplicationPercentage = options?.duplicationPercentage ?? 0;
      const typeCoveragePercentage = options?.typeCoveragePercentage ?? 100;

      const breakdown = computeBreakdown(metrics, {
        duplicationPercentage,
        typeCoveragePercentage,
      });

      const weights = selectWeights(metrics.language);
      const overall = computeOverall(breakdown, weights);
      const grade = scoreToGrade(overall);

      const signalIssues = generateSignalIssues(breakdown, metrics);
      const perFunctionIssues = generatePerFunctionIssues(metrics);
      const codeSmellIssues = generateCodeSmellIssues(metrics);
      const issues = [...signalIssues, ...perFunctionIssues, ...codeSmellIssues];

      deps.logger.info("Scored file", {
        filePath: metrics.filePath,
        overall,
        grade,
        issueCount: issues.length,
      });

      return { overall, breakdown, grade, issues };
    },

    scoreDirectory(fileScores) {
      if (fileScores.length === 0) {
        deps.logger.info("No files to score for directory");
        return { overall: 10, grade: "A" as HealthGrade };
      }

      const sum = fileScores.reduce(
        (acc, entry) => acc + entry.score.overall,
        0,
      );
      const overall = round2(clamp(sum / fileScores.length, 1, 10));
      const grade = scoreToGrade(overall);

      deps.logger.info("Scored directory", {
        fileCount: fileScores.length,
        overall,
        grade,
      });

      return { overall, grade };
    },
  };
}
