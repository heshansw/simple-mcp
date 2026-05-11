import { z } from "zod";

// ── Enums & Constants ───────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES = ["typescript", "javascript", "java"] as const;
export const SupportedLanguageSchema = z.enum(SUPPORTED_LANGUAGES);
export type SupportedLanguage = z.infer<typeof SupportedLanguageSchema>;

export const SUPPORTED_EXTENSIONS: Record<SupportedLanguage, ReadonlyArray<string>> = {
  typescript: [".ts", ".tsx"],
  javascript: [".js", ".jsx", ".mjs"],
  java: [".java"],
} as const;

export const ALL_SUPPORTED_EXTENSIONS = Object.values(SUPPORTED_EXTENSIONS).flat();

export const HealthGradeSchema = z.enum(["A", "B", "C", "D", "F"]);
export type HealthGrade = z.infer<typeof HealthGradeSchema>;

export const EventTypeSchema = z.enum([
  "pre_commit_check",
  "post_commit_analysis",
  "pr_analysis",
  "snapshot",
  "session_check",
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const SessionStatusSchema = z.enum(["active", "completed", "failed"]);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const TriggerTypeSchema = z.enum(["hook", "manual", "scheduled", "post_hook", "pre_commit"]);
export type TriggerType = z.infer<typeof TriggerTypeSchema>;

// ── Signal weights ──────────────────────────────────────────────────────

export const SIGNAL_WEIGHTS = {
  complexity: 0.22,
  maintainability: 0.18,
  duplication: 0.13,
  functionSize: 0.13,
  typeSafety: 0.10,
  nestingDepth: 0.08,
  parameterCount: 0.06,
  codeSmells: 0.10,
} as const;

export const SIGNAL_WEIGHTS_NO_TYPES = {
  complexity: 0.27,
  maintainability: 0.23,
  duplication: 0.13,
  functionSize: 0.13,
  typeSafety: 0,
  nestingDepth: 0.08,
  parameterCount: 0.06,
  codeSmells: 0.10,
} as const;

// ── Halstead Metrics ────────────────────────────────────────────────────

export const HalsteadMetricsSchema = z.object({
  effort: z.number(),
  difficulty: z.number(),
  volume: z.number(),
  vocabulary: z.number(),
  length: z.number(),
  bugs: z.number(),
});
export type HalsteadMetrics = z.infer<typeof HalsteadMetricsSchema>;

// ── Function-level metrics ──────────────────────────────────────────────

export const FunctionMetricsSchema = z.object({
  name: z.string(),
  startLine: z.number().int(),
  endLine: z.number().int(),
  loc: z.number().int(),
  parameterCount: z.number().int(),
  cyclomatic: z.number().int(),
  cognitive: z.number().int(),
  halstead: HalsteadMetricsSchema,
  nestingDepth: z.number().int(),
});
export type FunctionMetrics = z.infer<typeof FunctionMetricsSchema>;

// ── File-level AST metrics ──────────────────────────────────────────────

export const FileAstMetricsSchema = z.object({
  filePath: z.string(),
  language: SupportedLanguageSchema,
  loc: z.number().int(),
  slocLogical: z.number().int(),
  functions: z.array(FunctionMetricsSchema),
  averageCyclomatic: z.number(),
  maxCyclomatic: z.number(),
  averageCognitive: z.number(),
  maxCognitive: z.number(),
  maintainabilityIndex: z.number(),
  codeSmells: z.object({
    consoleStatements: z.number().int(),
    todoFixmeCount: z.number().int(),
    magicNumberCount: z.number().int(),
    commentRatio: z.number(),
    importCount: z.number().int(),
    isGodFile: z.boolean(),
  }).optional(),
  classMetrics: z.array(z.object({
    name: z.string(),
    fieldCount: z.number().int(),
    methodCount: z.number().int(),
    loc: z.number().int(),
    startLine: z.number().int(),
    endLine: z.number().int(),
  })).optional(),
});
export type FileAstMetrics = z.infer<typeof FileAstMetricsSchema>;

// ── Health Issue ────────────────────────────────────────────────────────

export const HealthIssueSeveritySchema = z.enum(["critical", "warning", "info"]);

export const HealthIssueSchema = z.object({
  severity: HealthIssueSeveritySchema,
  signal: z.string(),
  message: z.string(),
  filePath: z.string().optional(),
  line: z.number().int().optional(),
  functionName: z.string().optional(),
  suggestion: z.string().optional(),
});
export type HealthIssue = z.infer<typeof HealthIssueSchema>;

// ── Signal Breakdown ────────────────────────────────────────────────────

export const SignalBreakdownSchema = z.object({
  complexity: z.number().min(1).max(10),
  maintainability: z.number().min(1).max(10),
  duplication: z.number().min(1).max(10),
  functionSize: z.number().min(1).max(10),
  typeSafety: z.number().min(1).max(10),
  nestingDepth: z.number().min(1).max(10),
  parameterCount: z.number().min(1).max(10),
  codeSmells: z.number().min(1).max(10),
});
export type SignalBreakdown = z.infer<typeof SignalBreakdownSchema>;

// ── Health Score ────────────────────────────────────────────────────────

export const HealthScoreSchema = z.object({
  overall: z.number().min(1).max(10),
  breakdown: SignalBreakdownSchema,
  grade: HealthGradeSchema,
  issues: z.array(HealthIssueSchema),
});
export type HealthScore = z.infer<typeof HealthScoreSchema>;

// ── File Health Report ──────────────────────────────────────────────────

export const AiReviewResultSchema = z.object({
  aiScore: z.number().min(1).max(10),
  aiGrade: z.string(),
  issues: z.array(HealthIssueSchema),
  summary: z.string(),
  model: z.string(),
});
export type AiReviewResult = z.infer<typeof AiReviewResultSchema>;

export const FileHealthReportSchema = z.object({
  filePath: z.string(),
  language: SupportedLanguageSchema,
  score: HealthScoreSchema,
  metrics: FileAstMetricsSchema,
  functions: z.array(FunctionMetricsSchema).optional(),
  connectedFiles: z.array(z.string()).optional(),
  aiReviewResult: AiReviewResultSchema.optional(),
});
export type FileHealthReport = z.infer<typeof FileHealthReportSchema>;

// ── Directory Health Report ─────────────────────────────────────────────

export const DirectoryHealthReportSchema = z.object({
  directoryPath: z.string(),
  overallScore: z.number().min(1).max(10),
  grade: HealthGradeSchema,
  fileCount: z.number().int(),
  totalLoc: z.number().int(),
  totalFunctions: z.number().int(),
  fileReports: z.array(FileHealthReportSchema),
  worstOffenders: z.array(z.object({
    filePath: z.string(),
    score: z.number(),
    grade: HealthGradeSchema,
    topIssue: z.string().optional(),
  })),
  distribution: z.object({
    A: z.number().int(),
    B: z.number().int(),
    C: z.number().int(),
    D: z.number().int(),
    F: z.number().int(),
  }),
});
export type DirectoryHealthReport = z.infer<typeof DirectoryHealthReportSchema>;

// ── Pre-Commit Check Result ─────────────────────────────────────────────

export const PreCommitResultSchema = z.object({
  pass: z.boolean(),
  filesChecked: z.number().int(),
  fileVerdicts: z.array(z.object({
    filePath: z.string(),
    beforeScore: z.number().optional(),
    currentScore: z.number(),
    regression: z.number().optional(),
    pass: z.boolean(),
  })),
  blockingIssues: z.array(HealthIssueSchema),
  suggestions: z.array(HealthIssueSchema),
});
export type PreCommitResult = z.infer<typeof PreCommitResultSchema>;

// ── Hotspot ─────────────────────────────────────────────────────────────

export const FileChurnInfoSchema = z.object({
  filePath: z.string(),
  commitCount: z.number().int(),
  uniqueAuthors: z.number().int(),
  bugFixCommits: z.number().int(),
  lastModified: z.string(),
  ageInDays: z.number().int(),
  linesAdded: z.number().int(),
  linesDeleted: z.number().int(),
});
export type FileChurnInfo = z.infer<typeof FileChurnInfoSchema>;

export const HotspotSchema = z.object({
  filePath: z.string(),
  healthScore: z.number(),
  churnScore: z.number(),
  bugFixRatio: z.number(),
  priorityScore: z.number(),
  commitCount: z.number().int(),
  uniqueAuthors: z.number().int(),
});
export type Hotspot = z.infer<typeof HotspotSchema>;

// ── Duplication ─────────────────────────────────────────────────────────

export const ClonePairSchema = z.object({
  fileA: z.string(),
  startLineA: z.number().int(),
  endLineA: z.number().int(),
  fileB: z.string(),
  startLineB: z.number().int(),
  endLineB: z.number().int(),
  lines: z.number().int(),
  tokens: z.number().int(),
});
export type ClonePair = z.infer<typeof ClonePairSchema>;

export const DuplicationReportSchema = z.object({
  directoryPath: z.string(),
  totalFiles: z.number().int(),
  totalLines: z.number().int(),
  duplicatedLines: z.number().int(),
  duplicationPercentage: z.number(),
  clones: z.array(ClonePairSchema),
});
export type DuplicationReport = z.infer<typeof DuplicationReportSchema>;

// ── Type Coverage ───────────────────────────────────────────────────────

export const TypeCoverageReportSchema = z.object({
  filePath: z.string(),
  coveragePercentage: z.number(),
  anyCount: z.number().int(),
  implicitAnyLocations: z.array(z.object({
    line: z.number().int(),
    column: z.number().int(),
    text: z.string(),
  })),
  missingReturnTypes: z.array(z.object({
    line: z.number().int(),
    functionName: z.string(),
  })),
  typeAssertionCount: z.number().int(),
});
export type TypeCoverageReport = z.infer<typeof TypeCoverageReportSchema>;

// ── Trend Data ──────────────────────────────────────────────────────────

export const TrendDataPointSchema = z.object({
  date: z.string(),
  score: z.number(),
  grade: HealthGradeSchema,
  fileCount: z.number().int().optional(),
});
export type TrendDataPoint = z.infer<typeof TrendDataPointSchema>;

export const HealthTrendReportSchema = z.object({
  targetPath: z.string(),
  period: z.string(),
  dataPoints: z.array(TrendDataPointSchema),
  trendDirection: z.enum(["improving", "declining", "stable"]),
  rateOfChange: z.number(),
  currentScore: z.number().optional(),
  previousScore: z.number().optional(),
});
export type HealthTrendReport = z.infer<typeof HealthTrendReportSchema>;

// ── Session ─────────────────────────────────────────────────────────────

export const SessionSummarySchema = z.object({
  sessionId: z.string(),
  status: SessionStatusSchema,
  directoryPath: z.string(),
  filesChanged: z.array(z.string()),
  initialScores: z.record(z.string(), z.number()),
  finalScores: z.record(z.string(), z.number()),
  totalIterations: z.number().int(),
  targetScore: z.number(),
  achievedTarget: z.boolean(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

// ── Tool Input Schemas ──────────────────────────────────────────────────

export const AnalyzeFileInputSchema = z.object({
  filePath: z.string().min(1).describe("Absolute path to the file to analyze"),
  includePerFunctionMetrics: z.boolean().default(true).describe("Include per-function metric breakdown"),
  includeSuggestions: z.boolean().default(true).describe("Include improvement suggestions"),
  scanImports: z.boolean().default(false).describe("Also analyze imported/connected files in background"),
  importDepth: z.number().int().min(0).max(3).default(1).describe("How deep to follow imports (0=none, 1=direct imports)"),
  aiReview: z.boolean().default(false).describe("Run Claude AI review on top of static analysis for deeper qualitative insights"),
});

export const AnalyzeDirectoryInputSchema = z.object({
  directoryPath: z.string().min(1).describe("Path to the directory to analyze"),
  workspaceId: z.string().optional().describe("Workspace ID to analyze (alternative to directoryPath)"),
  recursive: z.boolean().default(true).describe("Recursively analyze subdirectories"),
  extensions: z.array(z.string()).default([".ts", ".tsx", ".js", ".jsx", ".java"]).describe("File extensions to include"),
  maxFiles: z.number().int().positive().default(200).describe("Maximum number of files to analyze"),
  skipPatterns: z.array(z.string()).default(["node_modules", "dist", ".git", "build", "coverage"]).describe("Directory patterns to skip"),
});

export const SnapshotInputSchema = z.object({
  directoryPath: z.string().min(1).describe("Root directory to snapshot"),
  workspaceId: z.string().optional().describe("Workspace ID (alternative to directoryPath)"),
  label: z.string().optional().describe("Human label for this snapshot (e.g. 'v1.2.0', 'post-refactor')"),
  extensions: z.array(z.string()).default([".ts", ".tsx", ".js", ".jsx", ".java"]),
  skipPatterns: z.array(z.string()).default(["node_modules", "dist", ".git", "build", "coverage"]),
});

export const TrendsInputSchema = z.object({
  targetPath: z.string().min(1).describe("File or directory path to query trends for"),
  scope: z.enum(["file", "directory"]).default("directory"),
  period: z.enum(["7d", "30d", "90d", "all"]).default("30d"),
  granularity: z.enum(["daily", "weekly", "monthly"]).default("weekly"),
});

export const HotspotsInputSchema = z.object({
  directoryPath: z.string().min(1),
  lookbackDays: z.number().int().positive().default(90),
  topN: z.number().int().positive().default(20),
  gitBranch: z.string().optional(),
});

export const FunctionRankingInputSchema = z.object({
  targetPath: z.string().min(1),
  sortBy: z.enum(["cyclomatic", "cognitive", "halstead_effort", "loc", "parameter_count"]).default("cognitive"),
  limit: z.number().int().positive().default(50),
  minThreshold: z.number().optional(),
});

export const DuplicationInputSchema = z.object({
  directoryPath: z.string().min(1),
  minTokens: z.number().int().positive().default(50),
  minLines: z.number().int().positive().default(6),
  extensions: z.array(z.string()).default([".ts", ".tsx", ".js", ".jsx", ".java"]),
});

export const TypeCoverageInputSchema = z.object({
  targetPath: z.string().min(1),
  tsconfigPath: z.string().optional(),
});

export const PreCommitCheckInputSchema = z.object({
  directoryPath: z.string().min(1),
  filePaths: z.array(z.string().min(1)).min(1).describe("File paths to check"),
  maxAllowedRegression: z.number().min(0).max(10).default(0.5),
  requireMinScore: z.number().min(1).max(10).optional(),
});

export const AnalyzePrInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  failOnRegression: z.boolean().default(false),
  regressionThreshold: z.number().min(0).max(10).default(0.5),
});

export const StartSessionInputSchema = z.object({
  directoryPath: z.string().min(1),
  filePaths: z.array(z.string().min(1)).optional().describe("Files to track. If omitted, auto-detects via git diff"),
  targetScore: z.number().min(1).max(10).default(10),
  maxIterations: z.number().int().positive().default(5),
});

export const SessionCheckInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const EndSessionInputSchema = z.object({
  sessionId: z.string().min(1),
});

// ── Score thresholds ────────────────────────────────────────────────────

export function scoreToGrade(score: number): HealthGrade {
  if (score >= 8.5) return "A";
  if (score >= 7.0) return "B";
  if (score >= 5.0) return "C";
  if (score >= 3.0) return "D";
  return "F";
}
