import type { IntegrationType, AgentId } from "@shared/types";
import type { z } from "zod";

export type AgentStatus = "ready" | "missing_dependencies" | "disabled";

export type AgentDefinition = {
  readonly id: AgentId;
  readonly name: string;
  readonly description?: string;
  readonly version: string;
  readonly requiredIntegrations: readonly IntegrationType[];
  readonly requiredTools: readonly string[];
  readonly configSchema?: z.ZodType<unknown>;
  readonly systemPrompt: string;
};

export type AgentWithStatus = AgentDefinition & {
  readonly status: AgentStatus;
  readonly missingDependencies: readonly string[];
};
