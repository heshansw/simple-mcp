import { z } from "zod";
import type { AgentDefinition } from "./types";
import { createAgentId } from "@shared/types";

const JiraTriageConfigSchema = z.object({
  projectKey: z.string().min(1).describe("Jira project key"),
  triagePriority: z
    .enum(["highest", "high", "medium", "low", "lowest"])
    .describe("Default priority for triaged issues"),
  autoAssign: z.boolean().default(false).describe("Auto-assign triaged issues"),
});

export type JiraTriageConfig = z.infer<typeof JiraTriageConfigSchema>;

export const jiraTriageAgent: AgentDefinition = {
  id: createAgentId("jira-triage"),
  name: "Jira Triage Agent",
  description:
    "Automatically triage and categorize incoming Jira issues based on priority and team assignment",
  version: "1.0.0",
  requiredIntegrations: ["jira"],
  requiredTools: ["jira:search-issues", "jira:transition-issue"],
  configSchema: JiraTriageConfigSchema,
  systemPrompt: `You are a Jira triage agent responsible for categorizing and organizing incoming issues.
Your responsibilities:
- Review newly created issues in the assigned project
- Categorize issues by priority based on content and keywords
- Assign issues to appropriate team members when enabled
- Add relevant labels and components
- Ensure consistency in issue metadata
- Update issue descriptions with clarifications when needed

Always maintain a professional tone and provide clear reasoning for categorization decisions.`,
};
