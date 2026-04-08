import { z } from "zod";

export const JiraAdfDocumentSchema = z.object({
  type: z.literal("doc"),
  version: z.literal(1),
  content: z.array(z.unknown()),
}).passthrough();

export type JiraAdfDocument = z.infer<typeof JiraAdfDocumentSchema>;

export const JiraDescriptionInputSchema = z.object({
  description: z.string().min(1).optional(),
  descriptionMarkdown: z.string().min(1).optional(),
  descriptionAdf: JiraAdfDocumentSchema.optional(),
}).superRefine((value, ctx) => {
  const providedCount = [
    value.description,
    value.descriptionMarkdown,
    value.descriptionAdf,
  ].filter((item) => item !== undefined).length;

  if (providedCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide only one of description, descriptionMarkdown, or descriptionAdf",
      path: ["descriptionMarkdown"],
    });
  }
});

export const JiraCommentBodyInputSchema = z.object({
  body: z.string().min(1).optional(),
  bodyMarkdown: z.string().min(1).optional(),
  bodyAdf: JiraAdfDocumentSchema.optional(),
}).superRefine((value, ctx) => {
  const providedCount = [
    value.body,
    value.bodyMarkdown,
    value.bodyAdf,
  ].filter((item) => item !== undefined).length;

  if (providedCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide only one of body, bodyMarkdown, or bodyAdf",
      path: ["bodyMarkdown"],
    });
  }
});

export const JiraUpdateIssueInputSchema = z.object({
  issueKey: z.string().min(1, "Issue key is required"),
  summary: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  descriptionMarkdown: z.string().min(1).optional(),
  descriptionAdf: JiraAdfDocumentSchema.optional(),
  labels: z.array(z.string().min(1)).optional(),
  priority: z.string().min(1).optional(),
  assigneeAccountId: z.string().min(1).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date must be YYYY-MM-DD").nullable().optional(),
}).superRefine((value, ctx) => {
  const descriptionCount = [
    value.description,
    value.descriptionMarkdown,
    value.descriptionAdf,
  ].filter((item) => item !== undefined).length;

  if (descriptionCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide only one description format",
      path: ["descriptionMarkdown"],
    });
  }

  const hasUpdatableField = [
    value.summary,
    value.description,
    value.descriptionMarkdown,
    value.descriptionAdf,
    value.labels,
    value.priority,
    value.assigneeAccountId,
    value.dueDate,
  ].some((item) => item !== undefined);

  if (!hasUpdatableField) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one updatable field is required",
      path: ["issueKey"],
    });
  }
});

export type JiraDescriptionInput = z.infer<typeof JiraDescriptionInputSchema>;
export type JiraCommentBodyInput = z.infer<typeof JiraCommentBodyInputSchema>;
export type JiraUpdateIssueInput = z.infer<typeof JiraUpdateIssueInputSchema>;
