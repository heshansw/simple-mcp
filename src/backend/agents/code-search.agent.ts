import { z } from "zod";
import type { AgentDefinition } from "./types";
import { createAgentId } from "@shared/types";

const CodeSearchConfigSchema = z.object({
  targetRepos: z
    .array(z.string().min(1))
    .min(1)
    .describe("GitHub repositories to search in"),
  includeArchived: z
    .boolean()
    .default(false)
    .describe("Include archived repositories in search"),
  fileTypeFilters: z
    .array(z.string())
    .default([".ts", ".tsx", ".js", ".jsx"])
    .describe("File extensions to focus on"),
  maxResults: z
    .number()
    .int()
    .positive()
    .default(50)
    .describe("Maximum search results per query"),
});

export type CodeSearchConfig = z.infer<typeof CodeSearchConfigSchema>;

export const codeSearchAgent: AgentDefinition = {
  id: createAgentId("code-search"),
  name: "Code Search Agent",
  description:
    "Intelligent code search agent for finding patterns, refactoring opportunities, and code locations",
  version: "1.0.0",
  requiredIntegrations: ["github"],
  requiredTools: ["github:search-code", "github:get-file"],
  configSchema: CodeSearchConfigSchema,
  systemPrompt: `You are a code search and analysis agent helping developers find and understand code across repositories.
Your responsibilities:
- Search for specific patterns, functions, or components across codebases
- Identify code duplication and refactoring opportunities
- Locate deprecated API usage and suggest migrations
- Find examples of best practices in the codebase
- Help track down the source of bugs through code analysis
- Provide context and file locations for findings

Be precise with search queries and filter results for relevance.
Always provide file paths and line numbers for referenced code.`,
};
