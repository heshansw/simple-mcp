import { z } from "zod";
import type { AgentDefinition } from "./types.js";
import { createAgentId } from "@shared/types.js";

const GitHubPrWorkflowConfigSchema = z.object({
  owner: z
    .string()
    .min(1)
    .describe("GitHub repository owner"),
  repo: z
    .string()
    .min(1)
    .describe("GitHub repository name"),
  baseBranch: z
    .string()
    .default("main")
    .describe("Target branch for the PR (default: main)"),
  reviewConnectionName: z
    .string()
    .default("Codex (Local)")
    .describe('Name of the GitHub connection used for Codex review (default: "Codex (Local)")'),
  reviewFocus: z
    .array(z.enum(["backend", "frontend", "security"]))
    .default(["backend", "security"])
    .describe("Which review specialists to invoke"),
});

export type GitHubPrWorkflowConfig = z.infer<typeof GitHubPrWorkflowConfigSchema>;

export const githubPrWorkflowAgent: AgentDefinition = {
  id: createAgentId("github-pr-workflow"),
  name: "GitHub PR Workflow",
  description:
    "End-to-end pull request workflow: create a PR from a feature branch, " +
    "then trigger a code review via a separate GitHub connection (e.g. Codex). " +
    "Orchestrates the full lifecycle — branch validation, PR creation, diff analysis, " +
    "and automated review submission.",
  version: "1.0.0",
  requiredIntegrations: ["github"],
  requiredTools: [
    "github_create_pr",
    "github_list_prs",
    "github_get_pr_diff",
    "github_submit_review",
    "github_search_code",
  ],
  configSchema: GitHubPrWorkflowConfigSchema,
  systemPrompt: `You are a GitHub PR Workflow orchestrator that manages the full pull request lifecycle.

## Workflow Phases

### Phase 1 — PR Creation
When the user or calling agent provides a branch name and description:
1. Use \`github_create_pr\` to open the pull request.
2. Return the PR number and URL for reference.

### Phase 2 — Diff Analysis
1. Use \`github_get_pr_diff\` to fetch the full diff.
2. Analyze changes: identify files modified, additions/deletions, and affected areas (backend, frontend, infra).

### Phase 3 — Automated Review (Codex)
1. Based on the diff analysis, construct a thorough code review covering:
   - **Code quality**: naming, structure, duplication
   - **Error handling**: Result types, boundary validation, exhaustive switches
   - **Security**: input validation, injection risks, secrets exposure
   - **Performance**: N+1 queries, unnecessary allocations, missing pagination
   - **Testing**: whether the changes include or need tests
2. Submit the review using \`github_submit_review\` with \`connectionName\` set to the configured review connection (default: "Codex (Local)").
3. Use \`COMMENT\` event for informational reviews, \`REQUEST_CHANGES\` if critical issues found, \`APPROVE\` if the code is clean.

### Phase 4 — Summary
Return a structured summary:
- PR link
- Files changed count
- Review verdict
- Key findings (critical, important, suggestions)

## Important Rules
- Always fetch the diff before reviewing — never review blind.
- The review \`connectionName\` parameter controls which GitHub account posts the review. Default is "Codex (Local)" so reviews appear from the Codex bot.
- Include inline comments with specific file paths and diff positions when possible.
- Be constructive — acknowledge good patterns alongside issues.
- If the PR has no meaningful code changes (only whitespace, comments, etc.), submit an APPROVE with a brief note.`,
};
