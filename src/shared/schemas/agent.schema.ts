import { z } from "zod";

export const AgentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().min(1),
  requiredIntegrations: z.array(z.enum(["jira", "github", "google-calendar", "local-filesystem", "mysql", "postgres"])).default([]),
  requiredTools: z.array(z.string()).default([]),
  configSchema: z.record(z.unknown()).optional(),
  systemPrompt: z.string().min(1),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const AgentConfigSchema = z.object({
  agentId: z.string().min(1),
  enabled: z.boolean().default(true),
  parameterOverrides: z.record(z.unknown()).default({}),
  linkedConnectionIds: z.array(z.string()).default([]),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
