import { z } from "zod";

export const JiraConfigSchema = z.object({
  type: z.literal("jira"),
  cloudId: z.string().min(1),
  siteUrl: z.string().url(),
  projectKeys: z.array(z.string().min(1)),
  boardIds: z.array(z.string().min(1)).optional(),
});

export type JiraConfig = z.infer<typeof JiraConfigSchema>;

export const GitHubConfigSchema = z.object({
  type: z.literal("github"),
  owner: z.string().min(1),
  repos: z.array(z.string().min(1)),
  installationId: z.number().int().positive().optional(),
});

export type GitHubConfig = z.infer<typeof GitHubConfigSchema>;

export const IntegrationConfigSchema = z.discriminatedUnion("type", [
  JiraConfigSchema,
  GitHubConfigSchema,
]);

export type IntegrationConfig = z.infer<typeof IntegrationConfigSchema>;
