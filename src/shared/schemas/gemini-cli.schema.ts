import { z } from "zod";
import { ReviewVerdictSchema, DraftCommentSchema } from "./review-session.schema.js";

export const GeminiCliConfigSchema = z.object({
  binaryPath: z.string().min(1).default("gemini"),
  timeoutMs: z.number().int().positive().default(120_000),
  model: z.string().min(1).default("gemini-2.5-flash"),
});
export type GeminiCliConfig = z.infer<typeof GeminiCliConfigSchema>;

export const GeminiCliReviewOutputSchema = z.object({
  verdict: ReviewVerdictSchema,
  body: z.string().min(1),
  comments: z.array(DraftCommentSchema).default([]),
});
export type GeminiCliReviewOutput = z.infer<typeof GeminiCliReviewOutputSchema>;
