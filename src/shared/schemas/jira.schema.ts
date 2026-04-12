import { z } from "zod";

function requireExactlyOneOf(
  value: Record<string, unknown>,
  keys: readonly string[],
  ctx: z.RefinementCtx,
  message: string,
  path: string
): void {
  const providedCount = keys.filter((key) => value[key] !== undefined).length;

  if (providedCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
      path: [path],
    });
  }
}

export const JiraAdfDocumentSchema = z.object({
  type: z.literal("doc"),
  version: z.literal(1),
  content: z.array(z.unknown()),
}).passthrough();

export type JiraAdfDocument = z.infer<typeof JiraAdfDocumentSchema>;

export const JiraUserIdentifierInputObjectSchema = z.object({
  accountId: z.string().min(1).optional(),
  query: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
  emailAddress: z.string().email().optional(),
});

export const JiraUserIdentifierInputSchema = JiraUserIdentifierInputObjectSchema.superRefine((value, ctx) => {
  requireExactlyOneOf(
    value,
    ["accountId", "query", "displayName", "emailAddress"],
    ctx,
    "Provide exactly one of accountId, query, displayName, or emailAddress",
    "query"
  );
});

export type JiraUserIdentifierInput = z.infer<typeof JiraUserIdentifierInputSchema>;

export const JiraResolvedUserSchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string().min(1),
  emailAddress: z.string().optional(),
  active: z.boolean().optional(),
});

export type JiraResolvedUser = z.infer<typeof JiraResolvedUserSchema>;

export const JiraMentionInputSchema = JiraUserIdentifierInputObjectSchema.extend({
  placeholder: z.string().min(1, "Mention placeholder is required"),
}).superRefine((value, ctx) => {
  requireExactlyOneOf(
    value,
    ["accountId", "query", "displayName", "emailAddress"],
    ctx,
    "Provide exactly one of accountId, query, displayName, or emailAddress",
    "query"
  );
});

export type JiraMentionInput = z.infer<typeof JiraMentionInputSchema>;

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

export const JiraCommentBodyInputObjectSchema = z.object({
  body: z.string().min(1).optional(),
  bodyMarkdown: z.string().min(1).optional(),
  bodyAdf: JiraAdfDocumentSchema.optional(),
  mentions: z.array(JiraMentionInputSchema).min(1).optional(),
});

export const JiraCommentBodyInputSchema = JiraCommentBodyInputObjectSchema.superRefine((value, ctx) => {
  requireExactlyOneOf(
    value,
    ["body", "bodyMarkdown", "bodyAdf"],
    ctx,
    "Provide exactly one of body, bodyMarkdown, or bodyAdf",
    "bodyMarkdown"
  );
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

export const JiraFindUsersInputObjectSchema = JiraUserIdentifierInputObjectSchema.extend({
  maxResults: z.number().int().positive().max(20).default(10),
});

export const JiraFindUsersInputSchema = JiraFindUsersInputObjectSchema.superRefine((value, ctx) => {
  requireExactlyOneOf(
    value,
    ["accountId", "query", "displayName", "emailAddress"],
    ctx,
    "Provide exactly one of accountId, query, displayName, or emailAddress",
    "query"
  );
});

export type JiraFindUsersInput = z.infer<typeof JiraFindUsersInputSchema>;

export const JiraAssignIssueInputObjectSchema = z.object({
  issueKey: z.string().min(1, "Issue key is required"),
  assigneeAccountId: z.string().min(1).optional(),
  assigneeQuery: z.string().min(1).optional(),
  assigneeDisplayName: z.string().min(1).optional(),
  assigneeEmailAddress: z.string().email().optional(),
  unassign: z.boolean().default(false),
});

export const JiraAssignIssueInputSchema = JiraAssignIssueInputObjectSchema.superRefine((value, ctx) => {
  const identifierCount = [
    value.assigneeAccountId,
    value.assigneeQuery,
    value.assigneeDisplayName,
    value.assigneeEmailAddress,
  ].filter((item) => item !== undefined).length;

  if (value.unassign) {
    if (identifierCount > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Do not provide an assignee identifier when unassign is true",
        path: ["unassign"],
      });
    }
    return;
  }

  if (identifierCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide exactly one assignee identifier or set unassign to true",
      path: ["assigneeQuery"],
    });
  }
});

export type JiraAssignIssueInput = z.infer<typeof JiraAssignIssueInputSchema>;

export const JiraChangeStatusInputObjectSchema = z.object({
  issueKey: z.string().min(1, "Issue key is required"),
  targetStatusName: z.string().min(1, "Target status name is required"),
});

export const JiraChangeStatusInputSchema = JiraChangeStatusInputObjectSchema;

export type JiraChangeStatusInput = z.infer<typeof JiraChangeStatusInputSchema>;

export const JiraGetTransitionsInputObjectSchema = z.object({
  issueKey: z.string().min(1, "Issue key is required"),
});

export const JiraGetTransitionsInputSchema = JiraGetTransitionsInputObjectSchema;

export type JiraGetTransitionsInput = z.infer<typeof JiraGetTransitionsInputSchema>;

export type JiraDescriptionInput = z.infer<typeof JiraDescriptionInputSchema>;
export type JiraCommentBodyInput = z.infer<typeof JiraCommentBodyInputSchema>;
export type JiraUpdateIssueInput = z.infer<typeof JiraUpdateIssueInputSchema>;
