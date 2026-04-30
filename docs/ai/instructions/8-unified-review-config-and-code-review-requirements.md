# 8 — Unified Review Configuration & Local Code Review Requirements

> **Status:** Planned
> **Created:** 2026-04-30
> **Updated:** 2026-04-30
> **Depends On:** Multi-Agent PR Review (doc 7) — all tables, tools, and agents defined there are prerequisites

---

## 1. Context & Business Value

### 1.1 Goal

This document specifies two tightly coupled features that extend the multi-agent review system defined in doc 7:

**Feature A — Unified Review Configuration:** Replace the current `(owner, repo, aiTool)` unique key on `repo_review_configs` with a richer `(owner, repo, agentId, aiTool)` model. This allows multiple agents per AI tool per repository — for example, Claude running both `backend-pr-reviewer` and `security-reviewer` in the same review session.

**Feature B — Local Code Review:** Add a parallel review flow for local git diffs (not GitHub PRs). A developer can ask an AI client to review staged changes, unstaged changes, or changes against a branch. The system fans out to the same configured agents, collects drafts, synthesises a report, and returns it to the terminal. The report is also stored and viewable in the admin panel.

### 1.2 Target Audience

- Developers using Claude Code, Gemini CLI, or Codex CLI as MCP clients
- The `review-synthesiser` agent (internal consumer of draft and config tools)
- The admin panel (read-only display of code review reports)

### 1.3 Why These Two Features Are Coupled

Both features read from the same `repo_review_configs` table. Feature A changes that table's shape. Feature B depends on the new shape. They must be implemented together in a single migration.

---

## 2. System Architecture & Integrations

### 2.1 Dependencies

- **SQLite via `better-sqlite3` + Drizzle ORM** — all new tables, all schema changes
- **Existing `repo_review_configs` table** — requires breaking schema change (unique constraint replacement, data migration)
- **Existing `review_sessions` + `review_session_drafts` tables** — extended by Feature B (see session/draft strategy decision in section 4)
- **Existing `store_agent_review_draft` MCP tool** — extended with optional `codeReviewSessionId`
- **Existing `review-synthesiser` agent** — reused unchanged for code review synthesis
- **Node.js `child_process` (execSync/spawnSync)** — used only for `git diff` invocation inside `start_code_review_session`; no external AI APIs called
- **No new npm dependencies** — git is invoked as a subprocess; no git library needed

### 2.2 Communication Patterns

All new tools follow the existing pattern: registered via `server.registerTool` (MCP protocol) AND in `ToolHandlerRegistry` (agent engine access). All tool inputs pass through Zod validation at the boundary before any business logic executes.

### 2.3 Architecture Diagram

```
External MCP client
      │
      ▼
start_code_review_session          start_pr_review_session (unchanged entry point)
      │                                         │
      │ (reads same table)                      │ (reads same table)
      ▼                                         ▼
repo_review_configs ←─── Feature A schema ────────────────────────────────┐
(owner, repo, agentId, aiTool)                                             │
      │                                                                    │
      ▼                                                                    │
code_review_sessions ──FK──► code_review_drafts      review_sessions ──FK──► review_session_drafts
      │                                                     │
      └──────────────────────────────────────────────────── ┘
                                │
                     store_agent_review_draft
                     (dispatched to by all AI clients)
                                │
                     review-synthesiser agent
                                │
               ┌────────────────┴────────────────┐
               ▼                                  ▼
     publish_code_review_report        publish_consolidated_review
       (code review path)                 (PR review path)
```

---

## 3. Decision Record: Session and Draft Table Strategy

### 3.1 The Choice

The prompt asks the BA to make a clear recommendation on whether to reuse the existing `review_sessions` / `review_session_drafts` tables with a `sessionType` discriminator, or to create separate tables for code reviews.

**Recommendation: Create separate tables (`code_review_sessions` and `code_review_drafts`).**

### 3.2 Reasoning

| Criterion | Shared table with discriminator | Separate tables (recommended) |
|---|---|---|
| Schema clarity | Many columns nullable per type (e.g. `prNumber` null for code reviews, `repoPath` null for PR reviews) | Each table has only meaningful columns — no nullable-by-design fields |
| Query simplicity | Every query must include `WHERE session_type = 'code'` to avoid mixing rows | No filter needed; queries are unambiguous |
| FK integrity | `review_session_drafts.sessionId` points to one table, but the session could be either type — impossible to enforce type-safety at DB level | `code_review_drafts.codeReviewSessionId` has a typed FK to `code_review_sessions` exclusively |
| Migration risk | Altering `review_sessions` risks breaking the existing PR review flow (doc 7 is already defined and partially implemented) | New tables are additive; existing tables are untouched |
| Future divergence | Code review sessions will accumulate fields PR reviews do not need (e.g. `diffContent`, `filesChanged`, `reportMarkdown`) | Each table evolves independently without polluting the other |
| Admin panel | Listing PR reviews vs code reviews on different routes is simpler when they are different tables | Same benefit |

The only downside of separate tables is that `store_agent_review_draft` must accept either a `sessionId` (PR review) or a `codeReviewSessionId` (code review). This is a contained change to one tool and is specified precisely in section 6.3.

### 3.3 Draft Table Decision

`code_review_drafts` is a separate table with a `codeReviewSessionId` FK to `code_review_sessions`. It has the same column structure as `review_session_drafts` because the content of a draft (verdict, body, commentsJson) is identical regardless of review type. This is data reuse at the column level, not table reuse.

---

## 4. Feature A — Unified Review Configuration

### 4.1 Problem Statement

The current `repo_review_configs` table has a unique constraint on `(owner, repo, aiTool)`. This means each AI tool can only be associated with one agent per repository. The new requirement allows multiple agents per AI tool — for example, Claude running both `backend-pr-reviewer` and `security-reviewer`.

### 4.2 Schema Change: `repo_review_configs` Table

**Breaking change.** The unique constraint changes from `(owner, repo, aiTool)` to `(owner, repo, agentId, aiTool)`. A data migration is required.

#### New Drizzle Schema

```typescript
export const repoReviewConfigsTable = sqliteTable(
  "repo_review_configs",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    agentId: text("agent_id").notNull(),
    aiTool: text("ai_tool").notNull(), // "claude" | "gemini" | "codex"
    enabled: integer("enabled").notNull().default(1),
    requiresExplicitSelection: integer("requires_explicit_selection").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    ownerRepoAgentToolUnique: uniqueIndex("repo_review_configs_owner_repo_agent_tool_unique")
      .on(table.owner, table.repo, table.agentId, table.aiTool),
    ownerRepoIdx: index("repo_review_configs_owner_repo_idx")
      .on(table.owner, table.repo),
  })
);
```

**Column changes from current schema:** No column additions or removals. The only structural change is the unique constraint. The `agent_id` column already exists (added in doc 7) — it is now part of the unique key.

#### Migration Strategy

The Drizzle migration must:
1. Drop the existing unique index `repo_review_configs_owner_repo_tool_unique`
2. Create the new unique index `repo_review_configs_owner_repo_agent_tool_unique`

Existing data is valid after migration because each existing row already has a distinct `(owner, repo, aiTool)` triple and an `agentId`. The new constraint is strictly more permissive — it allows more combinations, not fewer.

### 4.3 New Default Configuration Set

When `start_pr_review_session` or `start_code_review_session` is called for a repository with no config rows, auto-create these **five** defaults (not three):

| agentId | aiTool | enabled | requiresExplicitSelection |
|---|---|---|---|
| `backend-pr-reviewer` | `claude` | 1 | 0 |
| `security-reviewer` | `claude` | 1 | 0 |
| `backend-pr-reviewer` | `gemini` | 1 | 0 |
| `security-reviewer` | `gemini` | 1 | 0 |
| `backend-pr-reviewer` | `codex` | 0 | 1 |

The existing `createDefaults` repository function must be updated to produce these five rows.

**Note on existing repos:** Repositories that already have the old three-row default (`backend-pr-reviewer + claude`, `backend-pr-reviewer + gemini`, `backend-pr-reviewer + codex`) will not be automatically migrated to the new five-row default. New default rows are only created on first access. Existing rows remain as-is and are valid under the new constraint. The admin panel or `add_repo_review_agent` tool can be used to add the missing `security-reviewer` rows manually.

### 4.4 Updated `get_repo_review_config` Tool

The response changes from a flat list to a structure grouped by `aiTool`, showing all agents per tool.

Input (unchanged):
```json
{
  "owner": "string — repository owner",
  "repo": "string — repository name"
}
```

Output (new shape):
```json
{
  "owner": "string",
  "repo": "string",
  "configs": [
    {
      "id": "string",
      "agentId": "string",
      "aiTool": "claude | gemini | codex",
      "enabled": true,
      "requiresExplicitSelection": false,
      "createdAt": "ISO 8601",
      "updatedAt": "ISO 8601"
    }
  ],
  "groupedByTool": {
    "claude": [
      { "agentId": "backend-pr-reviewer", "enabled": true },
      { "agentId": "security-reviewer", "enabled": true }
    ],
    "gemini": [
      { "agentId": "backend-pr-reviewer", "enabled": true },
      { "agentId": "security-reviewer", "enabled": true }
    ],
    "codex": [
      { "agentId": "backend-pr-reviewer", "enabled": false }
    ]
  }
}
```

The `configs` array remains flat (one entry per row) for programmatic access. `groupedByTool` is a convenience structure for display.

If no config exists yet, returns `configs: []` and `groupedByTool: {}` — does NOT auto-create rows.

### 4.5 Updated `set_repo_review_config` Tool

`agentId` is now **required** (not optional). The upsert key changes to `(owner, repo, agentId, aiTool)`.

Input (new shape):
```json
{
  "owner": "string",
  "repo": "string",
  "agentId": "string — required, e.g. backend-pr-reviewer",
  "aiTool": "claude | gemini | codex",
  "enabled": "boolean",
  "requiresExplicitSelection": "boolean — optional"
}
```

Business rules (unchanged from doc 7 except the upsert key):
- `codex` cannot be set to `enabled: true` when its current `requiresExplicitSelection` is `true` unless `requiresExplicitSelection: false` is explicitly passed in the same call.
- Upsert by `(owner, repo, agentId, aiTool)` — finds matching row by all four fields.

Output (unchanged):
```json
{
  "updated": true,
  "config": { "...updated config row..." }
}
```

### 4.6 New `add_repo_review_agent` Tool

Convenience tool to add a new `(agentId, aiTool)` pair for a repository. Semantically equivalent to calling `set_repo_review_config` with `enabled: true` for a pair that does not yet exist, but named for discoverability.

Input:
```json
{
  "owner": "string",
  "repo": "string",
  "agentId": "string — agent definition ID to add",
  "aiTool": "claude | gemini | codex",
  "enabled": "boolean — default true",
  "requiresExplicitSelection": "boolean — default false"
}
```

Business rules:
- If a row already exists for `(owner, repo, agentId, aiTool)`, return `isError: true` with message: `"Config already exists for this agent+tool combination. Use set_repo_review_config to update it."` Do not silently upsert — the distinct tool name signals intent.
- `agentId` must be a known agent ID in the agent registry. If the agent ID is not found in the registry, return `isError: true`: `"Unknown agentId: {agentId}. Check available agents with list_agents."` (This validation prevents garbage data. Use the agent registry's in-memory list — no DB call needed.)

Output (success):
```json
{
  "created": true,
  "config": { "...new config row..." }
}
```

### 4.7 New `remove_repo_review_agent` Tool

Deletes a specific `(agentId, aiTool)` pair for a repository. Hard delete — no soft-delete.

Input:
```json
{
  "owner": "string",
  "repo": "string",
  "agentId": "string",
  "aiTool": "claude | gemini | codex"
}
```

Business rules:
- If no row exists for `(owner, repo, agentId, aiTool)`, return `isError: true`: `"No config found for this agent+tool combination."`
- If this is the LAST enabled row for the repository (deleting it would leave zero enabled configs), return `isError: true`: `"Cannot remove the last enabled agent config for this repository. Disable it instead, or add another agent first."` This prevents accidentally orphaning a repo's review config.

Output (success):
```json
{
  "removed": true,
  "owner": "string",
  "repo": "string",
  "agentId": "string",
  "aiTool": "string"
}
```

### 4.8 Impact on `start_pr_review_session`

The `enabledAgents` response array now contains one entry per enabled `(agentId, aiTool)` row — not one per enabled `aiTool`. With the new five-row default, a fresh repository returns four entries in `enabledAgents`:

```json
{
  "sessionId": "string",
  "enabledAgents": [
    { "aiTool": "claude", "agentId": "backend-pr-reviewer", "suggestedGoal": "..." },
    { "aiTool": "claude", "agentId": "security-reviewer", "suggestedGoal": "..." },
    { "aiTool": "gemini", "agentId": "backend-pr-reviewer", "suggestedGoal": "..." },
    { "aiTool": "gemini", "agentId": "security-reviewer", "suggestedGoal": "..." }
  ]
}
```

The `suggestedGoal` format per entry:
```
Review PR #{prNumber} in {owner}/{repo} as {agentId}. When complete, store your findings using store_agent_review_draft with sessionId={sessionId}, agentId={agentId}, aiTool={aiTool}.
```

### 4.9 Impact on `store_agent_review_draft`

The existing unique key for upsert was `(sessionId, aiTool)`. With multiple agents per aiTool possible, the upsert key becomes `(sessionId, agentId, aiTool)`.

This is a **breaking change to the existing tool's business logic** (not the input schema — `agentId` was already a required input field). The repository's upsert logic must be updated to use all three fields for conflict detection.

The `review_session_drafts` table does not need a new column — `agentId` already exists as a column. Only the upsert logic in the repository changes.

---

## 5. Feature B — Local Code Review

### 5.1 Overview

When a developer asks their AI client to review local code changes, the flow is:

1. Developer invokes `start_code_review_session` with a repo path and diff mode
2. Tool runs `git diff` in the specified repo, creates a `code_review_sessions` row
3. Returns the diff content + list of enabled agents (same config table as PR review)
4. Each AI client runs its review agent using the diff content, stores a `code_review_drafts` row via `store_agent_review_draft` (extended)
5. Coordinator triggers `review-synthesiser` with the code review session ID
6. Synthesiser calls `publish_code_review_report` (new tool) instead of `publish_consolidated_review`
7. Report is stored in `code_review_sessions.reportMarkdown`, returned to terminal, URL stored for admin panel

### 5.2 New DB Table: `code_review_sessions`

```typescript
export const codeReviewSessionsTable = sqliteTable("code_review_sessions", {
  id: text("id").primaryKey(),
  repoPath: text("repo_path").notNull(),
  repoName: text("repo_name").notNull(),      // e.g. "simple-mcp"
  repoOwner: text("repo_owner"),              // nullable — extracted from git remote if available
  diffMode: text("diff_mode").notNull(),      // "staged" | "unstaged" | "branch"
  branchName: text("branch_name"),            // nullable — only set when diffMode = "branch"
  status: text("status").notNull().default("pending"), // pending | reviewing | synthesising | completed | failed
  diffContent: text("diff_content").notNull(),
  filesChanged: integer("files_changed").notNull().default(0),
  additions: integer("additions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
  reportMarkdown: text("report_markdown"),    // nullable — set on completion
  reportUrl: text("report_url"),              // nullable — admin panel URL
  errorMessage: text("error_message"),        // nullable
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),          // nullable
});
```

**Indexes:**
- `repoPath` index for lookup by repository
- `status` index for listing active sessions

**Status state machine (identical to `review_sessions`):**
```
pending → reviewing → synthesising → completed
       ↘                           ↗
         failed (from any state)
```

### 5.3 New DB Table: `code_review_drafts`

```typescript
export const codeReviewDraftsTable = sqliteTable("code_review_drafts", {
  id: text("id").primaryKey(),
  codeReviewSessionId: text("code_review_session_id")
    .notNull()
    .references(() => codeReviewSessionsTable.id),
  agentId: text("agent_id").notNull(),
  aiTool: text("ai_tool").notNull(),          // "claude" | "gemini" | "codex"
  runId: text("run_id"),                      // nullable
  model: text("model"),                       // nullable
  verdict: text("verdict").notNull(),         // APPROVE | REQUEST_CHANGES | COMMENT
  body: text("body").notNull(),
  commentsJson: text("comments_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});
```

**Index:** `codeReviewSessionId` for draft retrieval by session.

**Note on identical structure to `review_session_drafts`:** The column names are intentionally identical (except the FK column name). This is not a schema smell — the content of a review draft is the same regardless of whether the subject is a PR diff or a local git diff. The FK column name is the only structural difference and is the mechanism that provides type-safe separation.

### 5.4 `store_agent_review_draft` — Extended

The existing tool accepts an optional `codeReviewSessionId`. Exactly one of `sessionId` or `codeReviewSessionId` must be provided — not both, not neither.

Updated input schema:
```json
{
  "sessionId": "string | null — ReviewSessionId (PR review)",
  "codeReviewSessionId": "string | null — CodeReviewSessionId (code review)",
  "agentId": "string — agent definition ID",
  "aiTool": "claude | gemini | codex",
  "runId": "string | null",
  "model": "string | null",
  "verdict": "APPROVE | REQUEST_CHANGES | COMMENT",
  "body": "string (min 1 char)",
  "comments": [
    {
      "path": "string",
      "position": "number (integer, positive)",
      "body": "string",
      "category": "bug | security | performance | style | test | docs | other"
    }
  ]
}
```

Business rules:
- If both `sessionId` and `codeReviewSessionId` are provided: return `isError: true`: `"Provide either sessionId or codeReviewSessionId, not both."`
- If neither is provided: return `isError: true`: `"Either sessionId or codeReviewSessionId must be provided."`
- If `sessionId` provided: look up `review_sessions`, validate status, upsert to `review_session_drafts` by `(sessionId, agentId, aiTool)` (updated key — see section 4.9)
- If `codeReviewSessionId` provided: look up `code_review_sessions`, validate status, upsert to `code_review_drafts` by `(codeReviewSessionId, agentId, aiTool)`
- Session-closed check applies to both paths: if status is `completed` or `failed`, return `isError: true`: `"Session is already closed."`

Output (unchanged):
```json
{
  "draftId": "string",
  "sessionId": "string | null",
  "codeReviewSessionId": "string | null",
  "aiTool": "string",
  "commentCount": "number"
}
```

### 5.5 New MCP Tool: `start_code_review_session`

Entry point for local code review. Reads the git diff, resolves the repository identity, creates a session, and returns the diff and agent list.

Input:
```json
{
  "repoPath": "string — absolute path to the git repository directory",
  "diffMode": "staged | unstaged | branch",
  "branchName": "string | null — required when diffMode is branch, null otherwise"
}
```

Business rules:
1. Validate `repoPath` is an absolute path (starts with `/`). Return `isError: true` if relative.
2. Validate the directory exists by attempting the git command — do not use `fs.existsSync` as a pre-check (avoids TOCTOU race). If the git command fails, the error message will indicate a missing or non-git directory.
3. Build the git command based on `diffMode`:
   - `"staged"` → `git -C {repoPath} diff --cached`
   - `"unstaged"` → `git -C {repoPath} diff`
   - `"branch"` → `git -C {repoPath} diff {branchName}...HEAD`
4. If `diffMode` is `"branch"` and `branchName` is null or empty: return `isError: true`: `"branchName is required when diffMode is branch."`
5. Run the git command synchronously via Node.js `child_process.spawnSync`. Capture stdout and stderr. Set a timeout of **30 seconds**. If the process times out: return `isError: true`: `"git diff timed out after 30 seconds. The diff may be too large."` Do NOT pass the raw stderr to the client — it may contain file system paths. Return a sanitised message.
6. If the diff output is empty (no changes): return `isError: true`: `"No changes found for the specified diff mode. Nothing to review."`
7. If the diff output exceeds **500 KB** (524,288 bytes): return `isError: true`: `"Diff is too large ({size} KB). Split your changes into smaller commits or review specific files."` (Include the actual size in the message.) This limit prevents unbounded memory use in the synthesiser's context.
8. Parse the diff to extract statistics (files changed, additions, deletions). Use line-counting on the raw diff text:
   - `filesChanged`: count lines starting with `diff --git`
   - `additions`: count lines starting with `+` (excluding `+++` header lines)
   - `deletions`: count lines starting with `-` (excluding `---` header lines)
9. Attempt to extract `owner/repo` from the git remote:
   - Run `git -C {repoPath} remote get-url origin` (timeout: 5 seconds)
   - Parse SSH format (`git@github.com:owner/repo.git`) and HTTPS format (`https://github.com/owner/repo.git`)
   - If parse succeeds: set `repoOwner` and use `{owner}/{repoName}` to look up `repo_review_configs`
   - If parse fails or no remote: set `repoOwner = null`, use only the directory name for display; look up configs using `owner = null, repo = {directoryName}` — this will find no rows, triggering default creation
10. Extract `repoName` as the last path segment of `repoPath` (e.g. `/Users/dev/projects/simple-mcp` → `simple-mcp`)
11. Look up `repo_review_configs` for the resolved `(owner, repo)`. If none found, auto-create the five defaults (same logic as `start_pr_review_session`).
12. Filter to enabled configs. If zero enabled: return `isError: true`: `"No agents are enabled for this repository. Use set_repo_review_config to enable at least one."`
13. Create a `code_review_sessions` row with `status: reviewing`.
14. Return session details, diff stats, and agent list.

Output (success):
```json
{
  "codeReviewSessionId": "string",
  "repoPath": "string",
  "repoName": "string",
  "repoOwner": "string | null",
  "diffMode": "staged | unstaged | branch",
  "branchName": "string | null",
  "status": "reviewing",
  "filesChanged": "number",
  "additions": "number",
  "deletions": "number",
  "diffContent": "string — the full raw diff (for agent consumption)",
  "enabledAgents": [
    {
      "aiTool": "claude | gemini | codex",
      "agentId": "string",
      "suggestedGoal": "string"
    }
  ],
  "instructions": "string — human-readable coordination guide"
}
```

The `suggestedGoal` format per entry:
```
Review the local code changes in {repoName} as {agentId}. The diff content is provided in the session. When complete, store your findings using store_agent_review_draft with codeReviewSessionId={codeReviewSessionId}, agentId={agentId}, aiTool={aiTool}.
```

The `instructions` field:
```
Session {codeReviewSessionId} created for {repoName} ({filesChanged} files, +{additions}/-{deletions}). Call agent_start_run for each entry in enabledAgents. Pass the diffContent from this response to each agent as context. When all drafts are stored, run agent_start_run with agentId=review-synthesiser and goal: "Synthesise code review session {codeReviewSessionId} for {repoName}".
```

### 5.6 New MCP Tool: `publish_code_review_report`

Called by the `review-synthesiser` agent after it has merged all code review drafts. Stores the report and returns formatted markdown for terminal display.

Input:
```json
{
  "codeReviewSessionId": "string",
  "verdict": "APPROVE | REQUEST_CHANGES | COMMENT",
  "reportMarkdown": "string — the full consolidated report in markdown format (min 1 char)",
  "agentSummaries": [
    {
      "aiTool": "claude | gemini | codex",
      "agentId": "string",
      "model": "string | null",
      "verdict": "APPROVE | REQUEST_CHANGES | COMMENT",
      "commentCount": "number"
    }
  ]
}
```

Processing steps:
1. Validate `codeReviewSessionId` exists. If not: return `isError: true`: `"Code review session not found."`
2. Validate session status is `reviewing` or `synthesising`. If `completed` or `failed`: return `isError: true`: `"Session is already closed."`
3. Generate `reportUrl`: `http://localhost:{adminPort}/code-reviews/{codeReviewSessionId}` (use the server's configured admin port; fall back to `3000` if not set)
4. Update `code_review_sessions`:
   - `status` → `completed`
   - `reportMarkdown` → provided value
   - `reportUrl` → generated URL
   - `completedAt` → current ISO 8601 timestamp
   - Perform in a single SQLite transaction.
5. Return the report markdown for terminal rendering.

Output (success):
```json
{
  "codeReviewSessionId": "string",
  "reportUrl": "string",
  "verdict": "string",
  "reportMarkdown": "string — the full report for terminal display"
}
```

The MCP client (Claude Code, Codex CLI) renders the returned `reportMarkdown` in the terminal.

Output (error):
```json
{
  "error": "string — sanitised message",
  "codeReviewSessionId": "string"
}
```

### 5.7 Report Format

The `reportMarkdown` stored and returned by `publish_code_review_report` follows this structure. The `review-synthesiser` agent is responsible for composing this content before calling the tool. The format is specified here so both the agent system prompt and the admin panel renderer are aligned.

```markdown
# Code Review — {repoName}

**{filesChanged} files changed** · +{additions} / -{deletions} · Diff mode: {diffMode}{branchSuffix}

## Agent Summary

| | AI Tool | Agent | Model | Verdict |
|---|---|---|---|---|
| <img src="..." /> | Claude | backend-pr-reviewer | `claude-sonnet-4` | REQUEST_CHANGES |
| <img src="..." /> | Claude | security-reviewer | `claude-sonnet-4` | COMMENT |
| <img src="..." /> | Gemini | backend-pr-reviewer | `gemini-2.5-pro` | APPROVE |

## Consolidated Verdict: REQUEST_CHANGES

---

## Findings

### Critical

#### {file-path}:{line-reference}
{category icon} {finding text}

---
<img src="..." /> **Claude** · Agent: `backend-pr-reviewer` · Model: `claude-sonnet-4`

### Important

...

### Suggestions

...

### Praise

...

---

[View full report in admin panel]({reportUrl})
```

Severity mapping from verdict/category:
- `bug` or `security` category → Critical
- `performance` or `test` category → Important
- `style`, `docs`, or `other` category → Suggestions
- Comments with an overall-positive sentiment (detected by the synthesiser agent) → Praise

The `branchSuffix` is ` vs branch \`{branchName}\`` when `diffMode = "branch"`, otherwise empty.

### 5.8 Review Synthesiser — Code Review Extension

The existing `review-synthesiser` agent is reused. Its system prompt must be extended with a **Code Review Mode** section that instructs it to call `publish_code_review_report` instead of `publish_consolidated_review` when the session is a code review session, and to use `get_code_review_session_drafts` (new tool, see section 5.9) to fetch drafts.

The agent determines the mode from its goal string:
- PR review goal: `"Synthesise review session {sessionId} for PR #{prNumber} in {owner}/{repo}"`
- Code review goal: `"Synthesise code review session {codeReviewSessionId} for {repoName}"`

The synthesiser applies the same deduplication rules (Exact → Adjacent → Divergent) and verdict escalation rule regardless of mode. The only difference is which fetch tool and publish tool it calls.

### 5.9 New MCP Tool: `get_code_review_session_drafts`

Retrieves all stored drafts for a code review session. Mirrors `get_review_session_drafts` for the code review path.

Input:
```json
{
  "codeReviewSessionId": "string"
}
```

Output (success):
```json
{
  "codeReviewSessionId": "string",
  "sessionStatus": "pending | reviewing | synthesising | completed | failed",
  "repoName": "string",
  "repoPath": "string",
  "diffMode": "staged | unstaged | branch",
  "filesChanged": "number",
  "additions": "number",
  "deletions": "number",
  "drafts": [
    {
      "id": "string",
      "agentId": "string",
      "aiTool": "string",
      "runId": "string | null",
      "model": "string | null",
      "verdict": "APPROVE | REQUEST_CHANGES | COMMENT",
      "body": "string",
      "comments": [ "...parsed from commentsJson..." ],
      "createdAt": "ISO 8601"
    }
  ]
}
```

Business rules:
- `drafts` ordered by `createdAt ASC`
- `comments` parsed from `commentsJson` using `DraftCommentSchema` (Zod array parse, strict). Any element that fails Zod validation is dropped and a warning is logged — the overall response does not fail.
- If `codeReviewSessionId` not found: return `isError: true`: `"Code review session not found."`

### 5.10 Admin Panel Routes

Two new frontend routes are required:

**`/code-reviews`** — Lists all code review sessions.

Displays a table with: repo name, diff mode, status, files changed, additions/deletions, verdict (when completed), date. Clicking a row navigates to the detail route. Reuse the existing reviews list page patterns and TanStack Query hooks.

**`/code-reviews/:sessionId`** — Shows the full report for a single session.

Renders `reportMarkdown` as HTML using a markdown renderer (the same library already used elsewhere in the admin panel, or `marked`/`markdown-it` if no existing renderer is present — do not add a new heavy dependency without checking first). When session `status` is not `completed`, show a status indicator instead of a report (e.g. "Review in progress…"). No polling in Phase 2 — user refreshes manually.

---

## 6. Data Models — Complete Drizzle Schema Additions

### 6.1 Modified Table: `repoReviewConfigsTable`

Replace the existing definition in `src/backend/db/schema.ts` (unique constraint change only):

```typescript
export const repoReviewConfigsTable = sqliteTable(
  "repo_review_configs",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    agentId: text("agent_id").notNull(),
    aiTool: text("ai_tool").notNull(), // "claude" | "gemini" | "codex"
    enabled: integer("enabled").notNull().default(1),
    requiresExplicitSelection: integer("requires_explicit_selection").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    ownerRepoAgentToolUnique: uniqueIndex("repo_review_configs_owner_repo_agent_tool_unique")
      .on(table.owner, table.repo, table.agentId, table.aiTool),
    ownerRepoIdx: index("repo_review_configs_owner_repo_idx")
      .on(table.owner, table.repo),
  })
);
```

### 6.2 New Table: `codeReviewSessionsTable`

```typescript
export const codeReviewSessionsTable = sqliteTable("code_review_sessions", {
  id: text("id").primaryKey(),
  repoPath: text("repo_path").notNull(),
  repoName: text("repo_name").notNull(),
  repoOwner: text("repo_owner"),             // nullable
  diffMode: text("diff_mode").notNull(),     // "staged" | "unstaged" | "branch"
  branchName: text("branch_name"),           // nullable
  status: text("status").notNull().default("pending"),
  diffContent: text("diff_content").notNull(),
  filesChanged: integer("files_changed").notNull().default(0),
  additions: integer("additions").notNull().default(0),
  deletions: integer("deletions").notNull().default(0),
  reportMarkdown: text("report_markdown"),   // nullable
  reportUrl: text("report_url"),             // nullable
  errorMessage: text("error_message"),       // nullable
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),         // nullable
});
```

### 6.3 New Table: `codeReviewDraftsTable`

```typescript
export const codeReviewDraftsTable = sqliteTable("code_review_drafts", {
  id: text("id").primaryKey(),
  codeReviewSessionId: text("code_review_session_id")
    .notNull()
    .references(() => codeReviewSessionsTable.id),
  agentId: text("agent_id").notNull(),
  aiTool: text("ai_tool").notNull(),         // "claude" | "gemini" | "codex"
  runId: text("run_id"),                     // nullable
  model: text("model"),                      // nullable
  verdict: text("verdict").notNull(),        // APPROVE | REQUEST_CHANGES | COMMENT
  body: text("body").notNull(),
  commentsJson: text("comments_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});
```

---

## 7. Zod Schemas

### 7.1 Updated `repo-review-config.schema.ts`

File: `src/shared/schemas/repo-review-config.schema.ts`

```typescript
import { z } from "zod";

export const AiToolSchema = z.enum(["claude", "gemini", "codex"]);
export type AiTool = z.infer<typeof AiToolSchema>;

export const RepoReviewConfigSchema = z.object({
  id: z.string(),
  owner: z.string().min(1),
  repo: z.string().min(1),
  agentId: z.string().min(1),
  aiTool: AiToolSchema,
  enabled: z.boolean(),
  requiresExplicitSelection: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RepoReviewConfig = z.infer<typeof RepoReviewConfigSchema>;

export const GetRepoReviewConfigInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

// agentId is now REQUIRED (breaking change from doc 7 spec where it was optional)
export const SetRepoReviewConfigInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  agentId: z.string().min(1),  // required
  aiTool: AiToolSchema,
  enabled: z.boolean(),
  requiresExplicitSelection: z.boolean().optional(),
});

export const AddRepoReviewAgentInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  agentId: z.string().min(1),
  aiTool: AiToolSchema,
  enabled: z.boolean().default(true),
  requiresExplicitSelection: z.boolean().default(false),
});

export const RemoveRepoReviewAgentInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  agentId: z.string().min(1),
  aiTool: AiToolSchema,
});
```

### 7.2 New `code-review.schema.ts`

File: `src/shared/schemas/code-review.schema.ts`

```typescript
import { z } from "zod";
import { AiToolSchema } from "./repo-review-config.schema.js";
import { ReviewVerdictSchema, DraftCommentSchema } from "./review-session.schema.js";

export const DiffModeSchema = z.enum(["staged", "unstaged", "branch"]);
export type DiffMode = z.infer<typeof DiffModeSchema>;

export const CodeReviewSessionStatusSchema = z.enum([
  "pending",
  "reviewing",
  "synthesising",
  "completed",
  "failed",
]);
export type CodeReviewSessionStatus = z.infer<typeof CodeReviewSessionStatusSchema>;

export const StartCodeReviewSessionInputSchema = z.object({
  repoPath: z.string().min(1).refine(
    (p) => p.startsWith("/"),
    { message: "repoPath must be an absolute path" }
  ),
  diffMode: DiffModeSchema,
  branchName: z.string().min(1).nullable().optional(),
}).refine(
  (data) => data.diffMode !== "branch" || (data.branchName != null && data.branchName.length > 0),
  { message: "branchName is required when diffMode is branch", path: ["branchName"] }
);
export type StartCodeReviewSessionInput = z.infer<typeof StartCodeReviewSessionInputSchema>;

export const CodeReviewSessionSchema = z.object({
  id: z.string(),
  repoPath: z.string(),
  repoName: z.string(),
  repoOwner: z.string().nullable(),
  diffMode: DiffModeSchema,
  branchName: z.string().nullable(),
  status: CodeReviewSessionStatusSchema,
  diffContent: z.string(),
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  reportMarkdown: z.string().nullable(),
  reportUrl: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type CodeReviewSession = z.infer<typeof CodeReviewSessionSchema>;

export const AgentSummarySchema = z.object({
  aiTool: AiToolSchema,
  agentId: z.string().min(1),
  model: z.string().nullable().optional(),
  verdict: ReviewVerdictSchema,
  commentCount: z.number().int().nonnegative(),
});

export const PublishCodeReviewReportInputSchema = z.object({
  codeReviewSessionId: z.string().min(1),
  verdict: ReviewVerdictSchema,
  reportMarkdown: z.string().min(1),
  agentSummaries: z.array(AgentSummarySchema),
});
export type PublishCodeReviewReportInput = z.infer<typeof PublishCodeReviewReportInputSchema>;

export const GetCodeReviewSessionDraftsInputSchema = z.object({
  codeReviewSessionId: z.string().min(1),
});
```

### 7.3 Updated `review-session.schema.ts`

The `StoreAgentReviewDraftInputSchema` must be updated to accept either `sessionId` or `codeReviewSessionId`:

```typescript
// Updated schema — replace the existing StoreAgentReviewDraftInputSchema
export const StoreAgentReviewDraftInputSchema = z.object({
  sessionId: z.string().min(1).nullable().optional(),
  codeReviewSessionId: z.string().min(1).nullable().optional(),
  agentId: z.string().min(1),
  aiTool: AiToolSchema,
  runId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  verdict: ReviewVerdictSchema,
  body: z.string().min(1),
  comments: z.array(DraftCommentSchema).default([]),
}).refine(
  (data) => {
    const hasSession = data.sessionId != null && data.sessionId.length > 0;
    const hasCodeSession = data.codeReviewSessionId != null && data.codeReviewSessionId.length > 0;
    return hasSession !== hasCodeSession; // XOR — exactly one must be set
  },
  { message: "Provide either sessionId or codeReviewSessionId, not both and not neither." }
);
```

---

## 8. Branded Types

Add to `src/shared/types.ts`:

```typescript
export type CodeReviewSessionId = Brand<string, "CodeReviewSessionId">;
export type CodeReviewDraftId = Brand<string, "CodeReviewDraftId">;

export function createCodeReviewSessionId(value: string): CodeReviewSessionId {
  return value as CodeReviewSessionId;
}
export function createCodeReviewDraftId(value: string): CodeReviewDraftId {
  return value as CodeReviewDraftId;
}
```

---

## 9. API Contracts / Interfaces

### 9.1 Repository Interfaces

#### `RepoReviewConfigsRepository` (updated)

```typescript
export interface RepoReviewConfigsRepository {
  findByOwnerRepo(owner: string, repo: string): Promise<RepoReviewConfig[]>;
  upsertConfig(data: {
    owner: string;
    repo: string;
    agentId: string;       // now always required
    aiTool: string;
    enabled: number;
    requiresExplicitSelection?: number;
  }): Promise<RepoReviewConfig>;
  insertConfig(data: {    // new — for add_repo_review_agent (insert only, no upsert)
    owner: string;
    repo: string;
    agentId: string;
    aiTool: string;
    enabled: number;
    requiresExplicitSelection: number;
  }): Promise<RepoReviewConfig>;
  deleteConfig(owner: string, repo: string, agentId: string, aiTool: string): Promise<void>;
  countEnabledForRepo(owner: string, repo: string): Promise<number>;
  createDefaults(owner: string, repo: string): Promise<RepoReviewConfig[]>;
}
```

#### `CodeReviewSessionsRepository` (new)

```typescript
export interface CodeReviewSessionsRepository {
  create(data: {
    repoPath: string;
    repoName: string;
    repoOwner: string | null;
    diffMode: string;
    branchName: string | null;
    diffContent: string;
    filesChanged: number;
    additions: number;
    deletions: number;
  }): Promise<CodeReviewSession>;
  findById(id: string): Promise<CodeReviewSession | null>;
  findByRepoPath(repoPath: string): Promise<CodeReviewSession[]>;
  listAll(): Promise<CodeReviewSession[]>;
  updateStatus(id: string, status: string, errorMessage?: string): Promise<void>;
  completeSession(id: string, data: {
    reportMarkdown: string;
    reportUrl: string;
    completedAt: string;
  }): Promise<void>;
}
```

#### `CodeReviewDraftsRepository` (new)

```typescript
export interface CodeReviewDraftsRepository {
  upsert(data: {
    codeReviewSessionId: string;
    agentId: string;
    aiTool: string;
    runId: string | null;
    model: string | null;
    verdict: string;
    body: string;
    commentsJson: string;
  }): Promise<CodeReviewDraft>;
  findBySession(codeReviewSessionId: string): Promise<CodeReviewDraft[]>;
}
```

---

## 10. Strict Business Rules & Logic

### 10.1 Config Management Rules

1. `set_repo_review_config`: `agentId` is required. Calls passing the old optional-`agentId` contract will now receive a Zod validation error.
2. `set_repo_review_config`: Codex safety guard — if the target row has `requiresExplicitSelection = 1` and the call sets `enabled = true` without explicitly passing `requiresExplicitSelection: false`, reject with: `"codex requires explicit opt-in. Pass requiresExplicitSelection: false to confirm you intend to enable it."`
3. `add_repo_review_agent`: Validates `agentId` against the in-memory agent registry before writing to DB. Unknown agent IDs are rejected.
4. `remove_repo_review_agent`: Checks `countEnabledForRepo` after the prospective delete. If the result would be zero enabled rows, reject.
5. Default creation (five rows) is transactional: all five rows or none. Use a SQLite transaction.

### 10.2 Code Review Session Rules

6. `repoPath` must be an absolute path. Reject relative paths before any git invocation.
7. Git diff is executed as a subprocess with a 30-second timeout. Stderr is captured but never returned to the client.
8. Diff size limit: 500 KB (524,288 bytes). Checked on the raw byte length of stdout.
9. Empty diff (zero bytes of output after trimming) → reject with a clear message.
10. Stats parsing is done on the raw diff text using line prefix counting. If the diff is malformed such that stats cannot be determined, default to `filesChanged: 0, additions: 0, deletions: 0` — do not fail the session creation.
11. Remote URL extraction: runs a separate `git remote get-url origin` with a 5-second timeout. If it fails for any reason (no remote, timeout, non-GitHub URL), set `repoOwner = null` and continue. Never fail session creation due to remote detection failure.
12. Config lookup uses `(repoOwner, repoName)` when owner is available; falls back to `(null, repoName)` when not. A `null` owner will never match existing config rows, so defaults are always created for repos without GitHub remotes.

### 10.3 Draft Storage Rules

13. Upsert key for PR review drafts: `(sessionId, agentId, aiTool)` — three fields, not two. (Breaking change from doc 7's `(sessionId, aiTool)` key.)
14. Upsert key for code review drafts: `(codeReviewSessionId, agentId, aiTool)` — same structure.
15. Exactly one of `sessionId` / `codeReviewSessionId` must be set. Validated by Zod refinement at the schema boundary.

### 10.4 Report Publishing Rules

16. `publish_code_review_report` performs the status update and report storage in a single SQLite transaction.
17. `reportUrl` uses the server's configured admin port. If the port config is unavailable at call time, fall back to `3000`.
18. The `reportMarkdown` stored in the DB is the canonical version. The tool returns it verbatim in the response for terminal display. No truncation is applied.

---

## 11. Edge Cases & Error Handling

| Scenario | Tool | Expected Behaviour |
|---|---|---|
| `repoPath` is a relative path | `start_code_review_session` | `isError: true`: `"repoPath must be an absolute path"` |
| `repoPath` is not a git repository | `start_code_review_session` | `isError: true`: `"Not a git repository or git command failed"` (sanitised, no raw stderr) |
| `diffMode: "branch"` but `branchName` is null | `start_code_review_session` | Zod refinement rejects at schema boundary: `"branchName is required when diffMode is branch"` |
| Git diff output is empty | `start_code_review_session` | `isError: true`: `"No changes found for the specified diff mode. Nothing to review."` |
| Git diff exceeds 500 KB | `start_code_review_session` | `isError: true` with actual size in the message |
| Git diff times out (> 30 s) | `start_code_review_session` | `isError: true`: `"git diff timed out after 30 seconds."` |
| `branchName` refers to a non-existent branch | `start_code_review_session` | Git command exits non-zero → `isError: true`: `"git diff failed. Ensure the branch exists and the repository is valid."` |
| Both `sessionId` and `codeReviewSessionId` provided | `store_agent_review_draft` | Zod refinement rejects: `"Provide either sessionId or codeReviewSessionId, not both and not neither."` |
| Neither `sessionId` nor `codeReviewSessionId` provided | `store_agent_review_draft` | Same Zod refinement rejection |
| `codeReviewSessionId` not found | `store_agent_review_draft` | `isError: true`: `"Code review session not found."` |
| Code review session is `completed` | `store_agent_review_draft` | `isError: true`: `"Session is already closed."` |
| `codeReviewSessionId` not found | `publish_code_review_report` | `isError: true`: `"Code review session not found."` |
| `add_repo_review_agent` with unknown `agentId` | `add_repo_review_agent` | `isError: true`: `"Unknown agentId: {agentId}. Check available agents with list_agents."` |
| `add_repo_review_agent` on existing pair | `add_repo_review_agent` | `isError: true`: `"Config already exists for this agent+tool combination. Use set_repo_review_config to update it."` |
| `remove_repo_review_agent` would leave zero enabled rows | `remove_repo_review_agent` | `isError: true`: `"Cannot remove the last enabled agent config for this repository."` |
| `set_repo_review_config` with unknown `aiTool` | `set_repo_review_config` | Zod parse failure → `isError: true` with Zod validation error message |
| `remove_repo_review_agent` row not found | `remove_repo_review_agent` | `isError: true`: `"No config found for this agent+tool combination."` |
| DB write fails (any tool) | Any | `isError: true` with sanitised message: `"Database error. Please try again."` — never expose SQL errors or stack traces |
| `get_code_review_session_drafts` with malformed `commentsJson` | `get_code_review_session_drafts` | Drop invalid elements, log warning, return remaining valid drafts. Do not fail the response. |

---

## 12. Acceptance Criteria (BDD Format)

### Feature A — Unified Config

**Given** a repository has no config rows
**When** `start_pr_review_session` is called for that repo
**Then** five default config rows are created (backend-pr-reviewer + claude, security-reviewer + claude, backend-pr-reviewer + gemini, security-reviewer + gemini, backend-pr-reviewer + codex disabled) and the session's `enabledAgents` contains four entries

**Given** a repository with the new five-row default config
**When** `start_pr_review_session` is called
**Then** `enabledAgents` contains four entries: `{claude, backend-pr-reviewer}`, `{claude, security-reviewer}`, `{gemini, backend-pr-reviewer}`, `{gemini, security-reviewer}`

**Given** `set_repo_review_config` is called without `agentId`
**When** the tool processes the input
**Then** Zod validation fails with a missing field error before any DB operation

**Given** an existing `(owner, repo, backend-pr-reviewer, claude)` config row
**When** `add_repo_review_agent` is called with the same combination
**Then** it returns `isError: true` with the "already exists" message and no DB write occurs

**Given** `add_repo_review_agent` is called with `agentId: "nonexistent-agent"`
**When** the tool validates against the agent registry
**Then** it returns `isError: true` before any DB operation

**Given** a repository with exactly one enabled config row
**When** `remove_repo_review_agent` is called for that row
**Then** it returns `isError: true` with the "last enabled config" message and no deletion occurs

**Given** `get_repo_review_config` is called for a repo with five config rows (four enabled, one disabled)
**When** the tool returns its response
**Then** `configs` contains all five rows, `groupedByTool.claude` contains two entries, `groupedByTool.codex` contains one entry with `enabled: false`

**Given** a draft already exists for `(sessionId, backend-pr-reviewer, claude)`
**When** `store_agent_review_draft` is called again with the same `(sessionId, backend-pr-reviewer, claude)` triple
**Then** the draft is overwritten and success is returned (upsert semantics)

**Given** drafts from `backend-pr-reviewer (claude)` and `security-reviewer (claude)` both exist for the same session
**When** `store_agent_review_draft` attempts to overwrite `(sessionId, security-reviewer, claude)`
**Then** only the `security-reviewer` draft is updated; the `backend-pr-reviewer` draft is unchanged

---

### Feature B — Code Review

**Given** `start_code_review_session` is called with `repoPath: "relative/path"`
**When** the input is validated
**Then** Zod refinement rejects with `"repoPath must be an absolute path"` before git is invoked

**Given** `start_code_review_session` is called with `diffMode: "branch"` and no `branchName`
**When** the input is validated
**Then** Zod refinement rejects with `"branchName is required when diffMode is branch"`

**Given** a valid git repository with staged changes at an absolute path
**When** `start_code_review_session` is called with `diffMode: "staged"`
**Then** a `code_review_sessions` row is created with `status: reviewing`, the diff content is returned, and `enabledAgents` lists the configured agents for the detected repository

**Given** a git repository with no staged changes
**When** `start_code_review_session` is called with `diffMode: "staged"`
**Then** `isError: true` is returned with the "No changes found" message and no session row is created

**Given** a git repository whose diff output exceeds 500 KB
**When** `start_code_review_session` processes the diff
**Then** `isError: true` is returned with the size in the message and no session row is created

**Given** a code review session in `reviewing` status
**When** `store_agent_review_draft` is called with `codeReviewSessionId` and valid draft data
**Then** a row is created in `code_review_drafts` and success is returned

**Given** `store_agent_review_draft` is called with both `sessionId` and `codeReviewSessionId` set
**When** Zod validates the input
**Then** validation fails with the XOR constraint error before any DB operation

**Given** a code review session with two drafts stored (from two agent+aiTool combinations)
**When** `get_code_review_session_drafts` is called
**Then** both drafts are returned with `comments` arrays parsed from `commentsJson`, ordered by `createdAt ASC`

**Given** the `review-synthesiser` agent receives a goal string containing `codeReviewSessionId`
**When** it synthesises all drafts
**Then** it calls `publish_code_review_report` (not `publish_consolidated_review`) and the session's `status` transitions to `completed`

**Given** `publish_code_review_report` is called with a valid `codeReviewSessionId` in `synthesising` status
**When** the tool processes the report
**Then** `code_review_sessions.reportMarkdown` is updated, `status` becomes `completed`, `reportUrl` is set, and the response contains the full `reportMarkdown` for terminal rendering — all in a single transaction

**Given** a completed code review session
**When** the admin panel `/code-reviews` route is accessed
**Then** the session appears in the list with repo name, diff mode, verdict, and file stats

**Given** a completed code review session with `reportMarkdown` populated
**When** the admin panel `/code-reviews/:sessionId` route is accessed
**Then** the `reportMarkdown` is rendered as HTML in the page

---

## 13. File Impact Summary

### New Files (22)

| # | Area | File | Purpose |
|---|---|---|---|
| 1 | Schema | `src/shared/schemas/code-review.schema.ts` | Zod schemas for code review session, diff mode, publish input |
| 2 | Repository | `src/backend/db/repositories/code-review-sessions.repository.ts` | CRUD + status transitions for `code_review_sessions` |
| 3 | Repository | `src/backend/db/repositories/code-review-drafts.repository.ts` | Upsert + retrieval for `code_review_drafts` |
| 4 | Tool | `src/backend/tools/github/add-repo-review-agent.tool.ts` | MCP tool: `add_repo_review_agent` |
| 5 | Tool | `src/backend/tools/github/remove-repo-review-agent.tool.ts` | MCP tool: `remove_repo_review_agent` |
| 6 | Tool | `src/backend/tools/github/start-code-review-session.tool.ts` | MCP tool: `start_code_review_session` |
| 7 | Tool | `src/backend/tools/github/publish-code-review-report.tool.ts` | MCP tool: `publish_code_review_report` |
| 8 | Tool | `src/backend/tools/github/get-code-review-session-drafts.tool.ts` | MCP tool: `get_code_review_session_drafts` |
| 9 | Route | `src/frontend/routes/code-reviews.tsx` | Admin panel list: `/code-reviews` |
| 10 | Route | `src/frontend/routes/code-reviews.$sessionId.tsx` | Admin panel detail: `/code-reviews/:sessionId` |
| 11 | API hook | `src/frontend/api/use-code-reviews.ts` | TanStack Query hooks for code review endpoints |
| 12 | Component | `src/frontend/components/CodeReviewList.tsx` | Session list table component |
| 13 | Component | `src/frontend/components/CodeReviewReport.tsx` | Report markdown renderer component |
| 14 | Repository test | `src/backend/db/repositories/code-review-sessions.repository.test.ts` | Unit tests: session repo |
| 15 | Repository test | `src/backend/db/repositories/code-review-drafts.repository.test.ts` | Unit tests: drafts repo |
| 16 | Tool test | `src/backend/tools/github/start-code-review-session.tool.test.ts` | Integration tests: git diff invocation, session creation, config lookup |
| 17 | Tool test | `src/backend/tools/github/publish-code-review-report.tool.test.ts` | Integration tests: report storage, status transition |
| 18 | Tool test | `src/backend/tools/github/add-repo-review-agent.tool.test.ts` | Unit tests: agent registry validation, insert guard |
| 19 | Tool test | `src/backend/tools/github/remove-repo-review-agent.tool.test.ts` | Unit tests: last-row guard, deletion |
| 20 | Schema test | `src/shared/schemas/code-review.schema.test.ts` | Zod schema acceptance + rejection tests |
| 21 | Migration | `src/backend/db/migrations/{timestamp}_unified_review_config.sql` | Drop old unique index, add new; add code_review_sessions + code_review_drafts tables |
| 22 | API endpoint | Backend HTTP handler for `/api/code-reviews` and `/api/code-reviews/:sessionId` | REST endpoints for admin panel consumption |

### Modified Files (11)

| # | File | Change |
|---|---|---|
| 1 | `src/backend/db/schema.ts` | Replace unique constraint on `repoReviewConfigsTable`; add `codeReviewSessionsTable` and `codeReviewDraftsTable` |
| 2 | `src/shared/schemas/repo-review-config.schema.ts` | Make `agentId` required in `SetRepoReviewConfigInputSchema`; add `AddRepoReviewAgentInputSchema` and `RemoveRepoReviewAgentInputSchema` |
| 3 | `src/shared/schemas/review-session.schema.ts` | Update `StoreAgentReviewDraftInputSchema` with XOR refinement for `sessionId` / `codeReviewSessionId`; add optional `model` field |
| 4 | `src/shared/types.ts` | Add `CodeReviewSessionId`, `CodeReviewDraftId` branded types and creator functions |
| 5 | `src/backend/db/repositories/repo-review-configs.repository.ts` | Update unique key from `(owner, repo, aiTool)` to `(owner, repo, agentId, aiTool)` in `upsertConfig`; add `insertConfig`, `deleteConfig`, `countEnabledForRepo`; update `createDefaults` to five rows |
| 6 | `src/backend/tools/github/store-agent-review-draft.tool.ts` | Add `codeReviewSessionId` path; update upsert key to `(sessionId, agentId, aiTool)` |
| 7 | `src/backend/tools/github/get-repo-review-config.tool.ts` | Update response shape to include `groupedByTool` |
| 8 | `src/backend/tools/github/set-repo-review-config.tool.ts` | Enforce `agentId` as required; update upsert call signature |
| 9 | `src/backend/agents/review-synthesiser.agent.ts` | Extend system prompt with Code Review Mode section; add `get_code_review_session_drafts` and `publish_code_review_report` to `requiredTools` |
| 10 | `src/backend/server.ts` | Register 5 new tools; inject new repos into tool deps; register code review HTTP endpoints |
| 11 | `src/backend/agents/engine/tool-handler-registry.ts` | Register 5 new tools: `add_repo_review_agent`, `remove_repo_review_agent`, `start_code_review_session`, `publish_code_review_report`, `get_code_review_session_drafts` |

---

## 14. Non-Functional Requirements

### 14.1 Security

- Git diff subprocess is invoked with `spawnSync` (not `exec`/`execSync` with shell: true). Arguments are passed as an array, not interpolated into a shell string. This prevents command injection via `repoPath` or `branchName`.
- `branchName` is passed directly as a git argument — git itself will reject invalid ref names. No additional sanitisation is needed beyond Zod's `string().min(1)`.
- Git stderr is captured and discarded. It is never included in MCP tool responses. Only sanitised, template-string error messages are returned to clients.
- `diffContent` stored in `code_review_sessions` may contain secrets if the developer has staged sensitive files. This is accepted behaviour — the diff is local-only data, stored in the local SQLite database under `~/.simple-mcp/data.db`, which is already excluded from git. No additional controls are specified for Phase 2.
- `reportMarkdown` stored in DB is user-generated content from the synthesiser agent. It is rendered in the admin panel — use a safe markdown renderer that does not execute arbitrary HTML (e.g. configure `marked` with `sanitize: true` or use `DOMPurify` post-render). The specific sanitisation mechanism is left to the frontend implementation agent.

### 14.2 Data Integrity

- Default config creation (five rows) uses a SQLite transaction.
- `completeSession` (code review) updates status, reportMarkdown, reportUrl, and completedAt in a single transaction.
- Foreign key enforcement: `PRAGMA foreign_keys = ON` must be set on DB connection startup (already required by doc 7).
- Draft upsert uses `INSERT OR REPLACE` or Drizzle's `.onConflictDoUpdate` targeting the composite key.

### 14.3 Performance

- `code_review_sessions.repoPath` index enables O(log n) lookup by path.
- `code_review_drafts.codeReviewSessionId` index bounds draft fetch to the number of agent+tool combinations (at most ~10 per session in normal usage).
- Diff size limit (500 KB) prevents unbounded memory allocation in the session creation path.
- Git subprocess timeout (30 s) prevents the tool from blocking indefinitely on large repositories.

### 14.4 Backward Compatibility

- `start_pr_review_session` remains fully backward compatible. Its input schema is unchanged. Its output gains more entries in `enabledAgents` but no fields are removed.
- `store_agent_review_draft`'s existing callers that pass only `sessionId` continue to work. The new `codeReviewSessionId` field is optional.
- `set_repo_review_config`'s `agentId` field changes from optional to required. This is a **breaking change** for any existing callers that relied on the default. Callers must be updated to pass `agentId` explicitly. Existing stored data is unaffected.
- `get_repo_review_config` output gains `groupedByTool` — additive change, backward compatible.

---

## 15. Out of Scope (Phase 2 Exclusions)

- **Automatic file-type routing** — configured agents always run regardless of which file types are in the diff. No skip logic based on `.tsx` / `.ts` file presence.
- **Webhook-triggered code reviews** — no CI/CD integration. Developer-initiated only.
- **Real-time review progress streaming** — admin panel does not poll or stream session status updates. Manual refresh only.
- **Codex opt-in behaviour changes** — `requiresExplicitSelection: true` for Codex is unchanged.
- **Diff content encryption** — `diffContent` stored in plain text in SQLite. Encryption at rest is a future enhancement.
- **Per-file-type agent routing** — e.g. routing `.tsx` files only to `frontend-pr-reviewer` — is explicitly excluded.
- **Automatic migration of existing three-row defaults to five-row defaults** — existing repos keep their current config rows unchanged.
- **`review-synthesiser` calling `publish_code_review_report` autonomously without coordinator involvement** — the coordinator still triggers the synthesiser via `agent_start_run`.
