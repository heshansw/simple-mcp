import { z } from "zod";

export const AiToolSchema = z.enum(["claude", "gemini", "codex"]);
export type AiTool = z.infer<typeof AiToolSchema>;

export const RepoReviewConfigSchema = z.object({
  id: z.string(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  agentId: z.string().min(1),
  aiTool: AiToolSchema,
  enabled: z.boolean(),
  requiresExplicitSelection: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RepoReviewConfig = z.infer<typeof RepoReviewConfigSchema>;

export const GetRepoReviewConfigInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

// agentId is now REQUIRED (breaking change from doc 7 spec where it was optional)
export const SetRepoReviewConfigInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  agentId: z.string().min(1),  // required
  aiTool: AiToolSchema,
  enabled: z.boolean(),
  requiresExplicitSelection: z.boolean().optional(),
});

export const AddRepoReviewAgentInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  agentId: z.string().min(1),
  aiTool: AiToolSchema,
  enabled: z.boolean().default(true),
  requiresExplicitSelection: z.boolean().default(false),
});

export const RemoveRepoReviewAgentInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  agentId: z.string().min(1),
  aiTool: AiToolSchema,
});
