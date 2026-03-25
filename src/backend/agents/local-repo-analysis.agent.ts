import { z } from "zod";
import type { AgentDefinition } from "./types";
import { createAgentId } from "@shared/types";

const LocalRepoAnalysisConfigSchema = z.object({
  defaultMaxDepth: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Default tree depth for file exploration"),
  preferredExtensions: z
    .array(z.string())
    .default([".ts", ".tsx", ".js", ".jsx", ".json", ".md"])
    .describe("File extensions to prioritize in analysis"),
  maxSearchResults: z
    .number()
    .int()
    .positive()
    .default(50)
    .describe("Maximum search results per query"),
});

export type LocalRepoAnalysisConfig = z.infer<typeof LocalRepoAnalysisConfigSchema>;

export const localRepoAnalysisAgent: AgentDefinition = {
  id: createAgentId("local-repo-analysis"),
  name: "Local Repository Analysis Agent",
  description:
    "Analyze local codebases, explore file structures, search across multiple repos, and provide code insights from registered filesystem paths and workspaces",
  version: "1.0.0",
  requiredIntegrations: ["local-filesystem"],
  requiredTools: [
    "fs_list_folders",
    "fs_list_workspaces",
    "fs_list_directory",
    "fs_read_file",
    "fs_search_files",
    "fs_get_file_tree",
    "fs_workspace_search",
    "fs_workspace_tree",
  ],
  configSchema: LocalRepoAnalysisConfigSchema,
  systemPrompt: `You are a local repository analysis agent with read-only access to registered local codebases and multi-repo workspaces.

Your capabilities:
- List registered folders (fs_list_folders) and workspaces (fs_list_workspaces) to discover available repos and their UUIDs
- Explore directory structures and file trees within registered folders
- Read file contents for code analysis and review
- Search files by glob pattern or content substring across single repos or entire workspaces
- Analyze multi-repo architectures via workspace cross-repo search
- Identify patterns, dependencies, and architectural decisions across codebases
- Trace shared library usage across microservices in a workspace

Important rules:
- ALWAYS call fs_list_folders or fs_list_workspaces FIRST to discover available IDs before using other tools
- All fs_ tools require UUIDs (not names) as folder_access_id or workspace_id
- You can ONLY access folders that have been explicitly registered by the user
- All access is read-only — you cannot modify, create, or delete files
- Respect file size limits and extension allowlists configured per folder
- When working with workspaces, some repos may be unavailable — handle gracefully
- Always provide relative paths in your analysis for reproducibility
- Prefer workspace-level tools when the user's question spans multiple repos`,
};
