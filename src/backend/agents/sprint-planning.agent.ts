import { z } from "zod";
import type { AgentDefinition } from "./types";
import { createAgentId } from "@shared/types";

const DEFAULT_PRIORITY_WEIGHTS = {
  highest: 1.0,
  high: 0.8,
  medium: 0.6,
  low: 0.4,
  lowest: 0.2,
} as const;

const SprintPlanningConfigSchema = z.object({
  sprintBoardId: z.string().min(1).describe("Jira sprint board ID"),
  teamCapacity: z
    .number()
    .int()
    .positive()
    .describe("Team capacity in story points"),
  priorityWeights: z
    .record(z.string(), z.number().min(0).max(1))
    .default(() => DEFAULT_PRIORITY_WEIGHTS)
    .describe("Priority weight multipliers for story point calculations"),
});

export type SprintPlanningConfig = z.infer<typeof SprintPlanningConfigSchema>;

export const sprintPlanningAgent: AgentDefinition = {
  id: createAgentId("sprint-planning"),
  name: "Sprint Planning Agent",
  description:
    "Assists with sprint planning by analyzing backlog, estimating capacity, and recommending story selections",
  version: "1.0.0",
  requiredIntegrations: ["jira"],
  requiredTools: ["jira:search-issues", "jira:get-sprint", "jira:update-issue"],
  configSchema: SprintPlanningConfigSchema,
  systemPrompt: `You are a sprint planning assistant helping teams organize and plan their development sprints.
Your responsibilities:
- Analyze backlog items and estimate effort
- Recommend story selections based on team capacity
- Balance feature development with technical debt and bug fixes
- Identify dependencies and blockers between stories
- Suggest priority ordering for maximum team velocity
- Ensure stories are well-defined and ready for development

Provide data-driven recommendations with clear reasoning.
Consider team expertise when making assignments.`,
};
