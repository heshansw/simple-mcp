import { z } from "zod";
import { AiToolSchema } from "./repo-review-config.schema.js";
import { ReviewVerdictSchema, DraftCommentSchema } from "./review-session.schema.js";

export const DiffModeSchema = z.enum(["staged", "unstaged", "branch"]);
export type DiffMode = z.infer<typeof DiffModeSchema>;

export const CodeReviewSessionStatusSchema = z.enum([
  "pending",
  "reviewing",
  "synthesising",
  "completed",
  "failed",
]);
export type CodeReviewSessionStatus = z.infer<typeof CodeReviewSessionStatusSchema>;

export const StartCodeReviewSessionInputSchema = z.object({
  repoPath: z.string().min(1).refine(
    (p) => p.startsWith("/"),
    { message: "repoPath must be an absolute path" }
  ),
  diffMode: DiffModeSchema,
  branchName: z.string().min(1).nullable().optional(),
}).refine(
  (data) => data.diffMode !== "branch" || (data.branchName != null && data.branchName.length > 0),
  { message: "branchName is required when diffMode is branch", path: ["branchName"] }
);
export type StartCodeReviewSessionInput = z.infer<typeof StartCodeReviewSessionInputSchema>;

export const CodeReviewSessionSchema = z.object({
  id: z.string(),
  repoPath: z.string(),
  repoName: z.string(),
  repoOwner: z.string().nullable(),
  diffMode: DiffModeSchema,
  branchName: z.string().nullable(),
  status: CodeReviewSessionStatusSchema,
  diffContent: z.string(),
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  reportMarkdown: z.string().nullable(),
  reportUrl: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type CodeReviewSession = z.infer<typeof CodeReviewSessionSchema>;

export const AgentSummarySchema = z.object({
  aiTool: AiToolSchema,
  agentId: z.string().min(1),
  model: z.string().nullable().optional(),
  verdict: ReviewVerdictSchema,
  commentCount: z.number().int().nonnegative(),
});

export const PublishCodeReviewReportInputSchema = z.object({
  codeReviewSessionId: z.string().min(1),
  verdict: ReviewVerdictSchema,
  reportMarkdown: z.string().min(1),
  agentSummaries: z.array(AgentSummarySchema),
});
export type PublishCodeReviewReportInput = z.infer<typeof PublishCodeReviewReportInputSchema>;

export const GetCodeReviewSessionDraftsInputSchema = z.object({
  codeReviewSessionId: z.string().min(1),
});

export { DraftCommentSchema, ReviewVerdictSchema };
