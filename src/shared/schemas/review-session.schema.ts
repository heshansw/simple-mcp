import { z } from "zod";
import { AiToolSchema } from "./repo-review-config.schema.js";

export const ReviewSessionStatusSchema = z.enum([
  "pending",
  "reviewing",
  "synthesising",
  "completed",
  "failed",
]);
export type ReviewSessionStatus = z.infer<typeof ReviewSessionStatusSchema>;

export const ReviewVerdictSchema = z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const CommentCategorySchema = z.enum([
  "bug",
  "security",
  "performance",
  "style",
  "test",
  "docs",
  "other",
]);
export type CommentCategory = z.infer<typeof CommentCategorySchema>;

export const DraftCommentSchema = z.object({
  path: z.string().min(1),
  position: z.number().int().positive(),
  body: z.string().min(1),
  category: CommentCategorySchema,
});
export type DraftComment = z.infer<typeof DraftCommentSchema>;

export const StoreAgentReviewDraftInputSchema = z.object({
  sessionId: z.string().min(1).nullable().optional(),
  codeReviewSessionId: z.string().min(1).nullable().optional(),
  agentId: z.string().min(1),
  aiTool: AiToolSchema,
  runId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  verdict: ReviewVerdictSchema,
  body: z.string().min(1),
  comments: z.array(DraftCommentSchema).default([]),
}).refine(
  (data) => {
    const hasSession = data.sessionId != null && data.sessionId.length > 0;
    const hasCodeSession = data.codeReviewSessionId != null && data.codeReviewSessionId.length > 0;
    return hasSession !== hasCodeSession; // XOR — exactly one must be set
  },
  { message: "Provide either sessionId or codeReviewSessionId, not both and not neither." }
);

export const GetReviewSessionDraftsInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const StartPrReviewSessionInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
});

export const ConsolidatedCommentSchema = z.object({
  path: z.string().min(1),
  position: z.number().int().positive(),
  body: z.string().min(1),
});

export const PublishConsolidatedReviewInputSchema = z.object({
  sessionId: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  verdict: ReviewVerdictSchema,
  body: z.string().min(1),
  comments: z.array(ConsolidatedCommentSchema).default([]),
});
