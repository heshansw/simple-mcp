# 7 — Multi-Agent Parallel PR Review Requirements

> **Status:** Planned
> **Created:** 2026-04-29
> **Updated:** 2026-04-29
> **Depends On:** Agent Execution Engine (doc 6), GitHub integration (tools: `github_get_pr_diff`, `github_submit_review`)

---

## 1. Overview

Extend the existing PR review flow into a **multi-agent parallel review system** where multiple AI tools (Claude, Gemini, Codex) review a PR simultaneously, each driving its own review loop via the existing `agent_start_run` mechanism. Their draft findings are stored without being posted to GitHub. A synthesiser agent then merges and deduplicates the findings, and a single consolidated review is posted to GitHub with per-finding attribution.

### Goals

- Produce richer, higher-confidence PR reviews by combining perspectives from multiple AI tools
- Avoid duplicate noise on GitHub (one review posted, not one per AI tool)
- Remain AI-API-key-free on the server — simple-mcp never calls Gemini or Codex APIs directly
- Provide full auditability: every draft stored, synthesis traceable

### Key Architectural Principle

simple-mcp acts as a **coordinator and state store** only. It does not drive AI inference for Gemini or Codex. External MCP clients (Claude Code, Gemini CLI, Codex CLI) each connect to the same simple-mcp server, receive their `agent_start_run` call, execute their own review loop using the server's GitHub tools, and store a draft via `store_agent_review_draft`. The user or a coordinator script fans out the work across clients and triggers synthesis when all drafts are in.

---

## 2. Requirements

### REQ-7.1: Per-Repository AI Tool Configuration

Configure which AI tools participate in reviews for each repository.

#### 2.1.1 Data Model — `repo_review_configs` Table

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Branded `RepoReviewConfigId` (UUID v4) |
| `owner` | text | NOT NULL | GitHub repository owner (e.g. `octocat`) |
| `repo` | text | NOT NULL | GitHub repository name (e.g. `hello-world`) |
| `agentId` | text | NOT NULL | Agent definition ID to run for this AI tool (e.g. `backend-pr-reviewer`) |
| `aiTool` | text | NOT NULL | One of: `claude`, `gemini`, `codex` |
| `enabled` | integer | NOT NULL, default `1` | `1` = enabled, `0` = disabled |
| `requiresExplicitSelection` | integer | NOT NULL, default `0` | `1` = opt-in only, never auto-enabled |
| `createdAt` | text | NOT NULL | ISO 8601 timestamp |
| `updatedAt` | text | NOT NULL | ISO 8601 timestamp |

**Unique constraint:** `(owner, repo, aiTool)` — one config row per repo+tool combination.

#### 2.1.2 Default Configuration Rules

- `claude` — `enabled: 1`, `requiresExplicitSelection: 0` (enabled by default for all repos)
- `gemini` — `enabled: 1`, `requiresExplicitSelection: 0` (enabled by default for all repos)
- `codex` — `enabled: 0`, `requiresExplicitSelection: 1` (opt-in only; never auto-enabled)
- When `start_pr_review_session` is called for a repo with no existing config rows, auto-create the three default rows before proceeding. This is the only place auto-creation occurs.

#### 2.1.3 MCP Tools

**`get_repo_review_config`**

Returns the current AI tool configuration for a repository.

Input:
```json
{
  "owner": "string — repository owner",
  "repo": "string — repository name"
}
```

Output (success):
```json
{
  "owner": "string",
  "repo": "string",
  "configs": [
    {
      "id": "string",
      "aiTool": "claude | gemini | codex",
      "agentId": "string",
      "enabled": true,
      "requiresExplicitSelection": false,
      "createdAt": "ISO 8601",
      "updatedAt": "ISO 8601"
    }
  ]
}
```

If no config exists yet, returns an empty `configs` array — does NOT auto-create rows. Auto-creation happens only at review start.

**`set_repo_review_config`**

Enable or disable a specific AI tool for a repository. If no row exists for the `(owner, repo, aiTool)` combination, creates it with the provided values (upsert semantics).

Input:
```json
{
  "owner": "string",
  "repo": "string",
  "aiTool": "claude | gemini | codex",
  "enabled": "boolean",
  "agentId": "string — optional, defaults to backend-pr-reviewer"
}
```

Business rule: `codex` cannot be set to `enabled: true` when `requiresExplicitSelection: true` unless the caller also passes `"requiresExplicitSelection": false` explicitly in the same call. This prevents accidental auto-enabling of opt-in tools.

Output (success):
```json
{
  "updated": true,
  "config": { "...updated config row..." }
}
```

#### 2.1.4 Acceptance Criteria

- Config rows are queryable by `(owner, repo)` with O(1) index lookup
- `set_repo_review_config` returns `400 Bad Request` equivalent if an unknown `aiTool` value is supplied
- Both tools are registered as MCP tools (via `server.registerTool`) AND in the `ToolHandlerRegistry` (for execution engine access)
- All inputs validated with Zod schemas at the tool boundary

---

### REQ-7.2: Review Session Management

Track the lifecycle of a multi-agent review from start to consolidated publication.

#### 2.2.1 Data Model — `review_sessions` Table

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Branded `ReviewSessionId` (UUID v4) |
| `owner` | text | NOT NULL | GitHub repository owner |
| `repo` | text | NOT NULL | GitHub repository name |
| `prNumber` | integer | NOT NULL | Pull request number |
| `status` | text | NOT NULL, default `pending` | State machine: `pending \| reviewing \| synthesising \| completed \| failed` |
| `errorMessage` | text | nullable | Set on `failed` status; never logged externally |
| `createdAt` | text | NOT NULL | ISO 8601 timestamp — when `start_pr_review_session` was called |
| `completedAt` | text | nullable | ISO 8601 timestamp — set when status reaches `completed` or `failed` |

**Index:** `(owner, repo, prNumber)` for session lookup by PR.

**Status state machine:**

```
pending → reviewing → synthesising → completed
       ↘                           ↗
         failed (from any state)
```

Transitions:
- `pending` → `reviewing`: when `start_pr_review_session` returns successfully and fan-out begins
- `reviewing` → `synthesising`: when all expected drafts are present (caller-driven, via `publish_consolidated_review` trigger)
- `synthesising` → `completed`: when `publish_consolidated_review` succeeds
- any → `failed`: on unrecoverable error (stored in `errorMessage`)

#### 2.2.2 Data Model — `review_session_drafts` Table

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | text | PK | Branded `ReviewSessionDraftId` (UUID v4) |
| `sessionId` | text | NOT NULL, FK → `review_sessions.id` | Parent session |
| `agentId` | text | NOT NULL | Agent definition ID that produced this draft |
| `aiTool` | text | NOT NULL | `claude \| gemini \| codex` |
| `runId` | text | nullable | `agent_runs.id` for the run that produced this draft (if run via engine) |
| `verdict` | text | NOT NULL | `APPROVE \| REQUEST_CHANGES \| COMMENT` |
| `body` | text | NOT NULL | Overall review summary written by the reviewing agent |
| `commentsJson` | text | NOT NULL, default `[]` | JSON array of inline comment objects (see schema below) |
| `createdAt` | text | NOT NULL | ISO 8601 timestamp |

`commentsJson` array element schema:
```json
{
  "path": "string — file path relative to repo root",
  "position": "number — diff position (integer, positive)",
  "body": "string — comment text",
  "category": "string — one of: bug | security | performance | style | test | docs | other"
}
```

**Index:** `sessionId` for draft retrieval by session.

#### 2.2.3 MCP Tool — `store_agent_review_draft`

Saves a reviewing agent's draft without posting anything to GitHub. Called by the reviewing AI client after it has analyzed the PR diff.

Input:
```json
{
  "sessionId": "string — ReviewSessionId",
  "agentId": "string — agent definition ID",
  "aiTool": "claude | gemini | codex",
  "runId": "string | null — agent run ID if applicable",
  "verdict": "APPROVE | REQUEST_CHANGES | COMMENT",
  "body": "string — overall review summary (min 1 char)",
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
- If `sessionId` does not exist in `review_sessions`, return error: session not found.
- If `sessionId` exists but `status` is `completed` or `failed`, return error: session already closed.
- If a draft already exists for `(sessionId, aiTool)`, overwrite it (upsert by `sessionId + aiTool`). This allows retries.
- `comments` array may be empty.

Output (success):
```json
{
  "draftId": "string",
  "sessionId": "string",
  "aiTool": "string",
  "commentCount": "number"
}
```

#### 2.2.4 MCP Tool — `get_review_session_drafts`

Retrieves all stored drafts for a session. Used by the synthesiser agent and for inspection.

Input:
```json
{
  "sessionId": "string — ReviewSessionId"
}
```

Output (success):
```json
{
  "sessionId": "string",
  "sessionStatus": "pending | reviewing | synthesising | completed | failed",
  "prNumber": "number",
  "owner": "string",
  "repo": "string",
  "drafts": [
    {
      "id": "string",
      "agentId": "string",
      "aiTool": "string",
      "runId": "string | null",
      "verdict": "APPROVE | REQUEST_CHANGES | COMMENT",
      "body": "string",
      "comments": [ "...parsed from commentsJson..." ],
      "createdAt": "ISO 8601"
    }
  ]
}
```

#### 2.2.5 Acceptance Criteria

- `store_agent_review_draft` is idempotent per `(sessionId, aiTool)` — safe to call on retry
- `get_review_session_drafts` returns drafts ordered by `createdAt ASC`
- Both tools registered as MCP tools AND in `ToolHandlerRegistry`
- Session status transitions are the responsibility of the coordinator (`start_pr_review_session` and `publish_consolidated_review`) — draft storage does not mutate session status

---

### REQ-7.3: Review Synthesiser Agent

A new specialist agent that merges multiple draft reviews into a single coherent consolidated review.

#### 2.3.1 Agent Definition

| Field | Value |
|---|---|
| ID | `review-synthesiser` |
| File | `src/backend/agents/review-synthesiser.agent.ts` |
| Required tools | `get_review_session_drafts`, `publish_consolidated_review` |
| Required integrations | `github` |

#### 2.3.2 Deduplication Rules (for system prompt and implementation guidance)

The synthesiser agent applies these rules when merging comments across drafts:

**Rule 1 — Exact Duplicate:** Same `path` + same `position` + same `category`
- Action: Keep one comment; append attribution for both AI tools.
- Output body: `{merged comment text}\n\n**[backend-pr-reviewer — Claude, backend-pr-reviewer — Gemini]**`

**Rule 2 — Adjacent Duplicate:** Same `path`, positions within ±3 lines of each other, same `category`
- Action: Merge into a single comment at the lower position (closest to the start of the changed block).
- Output body: Combined text from both, with attribution for all tools that flagged the range.

**Rule 3 — Divergent Finding:** Same `path` + same `position` + different `category` or contradictory assessment
- Action: Keep both as separate inline comments. Do not merge.

**Verdict Escalation Rule:** If any draft verdict is `REQUEST_CHANGES`, the consolidated verdict is `REQUEST_CHANGES`. Otherwise, if any is `COMMENT`, result is `COMMENT`. Only if all drafts are `APPROVE` is the consolidated verdict `APPROVE`.

Priority: `REQUEST_CHANGES` > `COMMENT` > `APPROVE`.

#### 2.3.3 Attribution Format

Every comment in the consolidated review must include attribution in the format:

```
{finding text}

**[{AgentName} — {AiTool}]**
```

For merged comments with multiple attributions:

```
{merged finding text}

**[{AgentName} — {AiTool1}, {AgentName2} — {AiTool2}]**
```

The overall review body must begin with a preamble:

```
> This review was produced by multiple AI agents: {list of aiTool values that submitted drafts}.
> Findings have been deduplicated and merged. See inline comments for per-finding attribution.

{synthesised summary body}
```

#### 2.3.4 System Prompt Outline

The system prompt for `review-synthesiser` must instruct the agent to:

1. Call `get_review_session_drafts` with the provided `sessionId`
2. Identify all draft reviews and their inline comments
3. Apply the three deduplication rules in order (exact → adjacent → divergent)
4. Determine the consolidated verdict via the escalation rule
5. Compose the consolidated review body with the standard preamble
6. Add attribution footers to all inline comments
7. Validate that all comment `position` values are positive integers (reject zero or negative)
8. Call `publish_consolidated_review` with the merged result
9. Report the GitHub review URL and comment count in the final answer

#### 2.3.5 Acceptance Criteria

- Agent is exported from `src/backend/agents/index.ts` and registered in the agent registry
- System prompt explicitly lists the deduplication rules in a numbered format that the LLM can follow mechanically
- Agent is visible in the admin panel agent list with status reflecting enabled/disabled state
- Agent can be invoked via `agent_start_run` with `goal`: `"Synthesise review session {sessionId} for PR #{prNumber} in {owner}/{repo}"`

---

### REQ-7.4: Synthesis & Publishing Tool

#### 2.4.1 MCP Tool — `publish_consolidated_review`

Posts a single GitHub review with the merged findings from all drafts. This tool is called by the `review-synthesiser` agent (or directly by the coordinator in future phases).

Input:
```json
{
  "sessionId": "string — ReviewSessionId",
  "owner": "string",
  "repo": "string",
  "prNumber": "number (integer, positive)",
  "verdict": "APPROVE | REQUEST_CHANGES | COMMENT",
  "body": "string — consolidated review body (min 1 char)",
  "comments": [
    {
      "path": "string",
      "position": "number (integer, positive)",
      "body": "string — comment with attribution footer"
    }
  ]
}
```

Business rules:
- Validate `sessionId` exists and has status `reviewing` or `synthesising`. Reject if `completed` or `failed`.
- Before posting to GitHub: validate that every comment's `position` is a positive integer. Remove any comment with `position <= 0` and log a warning (do not abort the entire review).
- Call `githubService.reviewPullRequest` with the validated input.
- On GitHub API success:
  - Update `review_sessions.status` to `completed`
  - Set `review_sessions.completedAt` to current ISO 8601 timestamp
  - Persist a row in the existing `reviews` table using `reviewsRepo.createCompleted` (for dashboard visibility)
- On GitHub API error: update session `status` to `failed` with `errorMessage`, then return an error result.
- Never leak GitHub API error details in the tool result — return a sanitised message.

Output (success):
```json
{
  "sessionId": "string",
  "githubReviewId": "number",
  "githubReviewUrl": "string",
  "verdict": "string",
  "inlineCommentsPosted": "number",
  "commentsDropped": "number"
}
```

Output (error):
```json
{
  "error": "string — sanitised message",
  "sessionId": "string"
}
```

#### 2.4.2 Acceptance Criteria

- Tool registered as MCP tool AND in `ToolHandlerRegistry`
- `commentsDropped` count is always returned so callers know if positions were invalid
- Session status updated atomically where possible (SQLite transaction)
- The existing `reviews` table row created on successful post ensures the review appears in the existing PR review dashboard
- Tool returns `isError: true` on failure so the execution engine records it as a failed tool call

---

### REQ-7.5: Coordinator Entry Point

#### 2.5.1 MCP Tool — `start_pr_review_session`

The single entry point for initiating a multi-agent review. Reads repo config, creates a session, and returns the information the external coordinator needs to fan out review runs.

Input:
```json
{
  "owner": "string",
  "repo": "string",
  "prNumber": "number (integer, positive)"
}
```

Processing steps (in order):

1. Look up `repo_review_configs` for `(owner, repo)`.
2. If no rows found, auto-create the three default config rows (`claude` enabled, `gemini` enabled, `codex` disabled) and use them.
3. Filter to configs where `enabled = 1`.
4. If zero enabled configs remain, return error: `"No AI tools are enabled for this repository. Use set_repo_review_config to enable at least one."`
5. Create a `review_sessions` row with `status: reviewing`, `owner`, `repo`, `prNumber`, `createdAt`.
6. Return the session details and the list of agents to dispatch.

Output (success):
```json
{
  "sessionId": "string",
  "owner": "string",
  "repo": "string",
  "prNumber": "number",
  "status": "reviewing",
  "enabledAgents": [
    {
      "aiTool": "claude | gemini | codex",
      "agentId": "string",
      "suggestedGoal": "string — pre-formatted goal string for agent_start_run"
    }
  ],
  "instructions": "string — human-readable instructions for the coordinator on next steps"
}
```

The `suggestedGoal` string for each enabled agent follows the format:

```
Review PR #{prNumber} in {owner}/{repo}. When complete, store your findings using store_agent_review_draft with sessionId={sessionId}.
```

The `instructions` field returns a plaintext guide:
```
Session {sessionId} created. Call agent_start_run for each entry in enabledAgents using the suggestedGoal. When all drafts are stored, run agent_start_run with agentId=review-synthesiser and goal: "Synthesise review session {sessionId} for PR #{prNumber} in {owner}/{repo}".
```

Output (error — no enabled tools):
```json
{
  "error": "No AI tools are enabled for this repository. Use set_repo_review_config to enable at least one.",
  "owner": "string",
  "repo": "string"
}
```

#### 2.5.2 Coordinator Flow (External, Not Implemented by simple-mcp in Phase 2)

The expected coordination sequence is:

```
1. MCP client calls start_pr_review_session → receives sessionId + enabledAgents list
2. For each entry in enabledAgents:
     MCP client (or script) calls agent_start_run(agentId, suggestedGoal)
3. Each AI tool drives its own review loop:
     - calls github_get_pr_diff to fetch the diff
     - analyzes the code
     - calls store_agent_review_draft with its findings
4. Coordinator polls agent_status for each runId until all reach completed/failed
5. Coordinator calls agent_start_run(agentId="review-synthesiser", goal=...)
6. Synthesiser fetches drafts, merges, posts consolidated review
7. Session status transitions to completed
```

simple-mcp does not spawn subprocesses or drive steps 2–5 in Phase 2. The external coordinator (user or script) is responsible.

#### 2.5.3 Acceptance Criteria

- `start_pr_review_session` is registered as an MCP tool AND in `ToolHandlerRegistry`
- Auto-creation of default configs is transactional (all three rows or none)
- The tool is idempotent per PR: if a session already exists for `(owner, repo, prNumber)` with status `reviewing` or `synthesising`, return the existing session rather than creating a duplicate. Sessions in `completed` or `failed` state allow a new session to be created.
- All inputs Zod-validated at the boundary

---

## 3. Non-Functional Requirements

### 3.1 Security

- `commentsJson` column is user-supplied text; never evaluate it as code. Parse strictly with Zod on read.
- GitHub API tokens are already encrypted in the `credentials` table. No changes needed.
- Error messages returned by tools never include raw GitHub API error bodies, SQL errors, or stack traces.
- `body` fields in drafts are stored as-is. Truncation is not applied (review bodies can be large). Storage concern is accepted in Phase 2.

### 3.2 Data Integrity

- `review_sessions` status transitions must use a SQLite transaction when also writing `completedAt` to prevent partial updates.
- Draft upsert (`store_agent_review_draft`) must use `INSERT OR REPLACE` or equivalent Drizzle upsert to guarantee idempotency.
- Foreign key from `review_session_drafts.sessionId` → `review_sessions.id` must be enforced (SQLite FK enforcement must be enabled: `PRAGMA foreign_keys = ON`).

### 3.3 Error Handling

| Scenario | Expected behaviour |
|---|---|
| `sessionId` not found in `store_agent_review_draft` | Return `isError: true`, message: `"Session not found"` |
| `sessionId` status is `completed` in `store_agent_review_draft` | Return `isError: true`, message: `"Session is already closed"` |
| GitHub API unreachable in `publish_consolidated_review` | Session → `failed`; return `isError: true`, sanitised message |
| All comment positions invalid in `publish_consolidated_review` | Drop all comments, post review body-only with `REQUEST_CHANGES` escalated; log warning |
| `set_repo_review_config` receives unknown `aiTool` value | Zod parse failure → return `isError: true`, validation error message |
| `start_pr_review_session` called for repo with all tools disabled | Return `isError: true` with guidance message (do not create a session) |
| DB write fails in `start_pr_review_session` | Return `isError: true`, message: `"Failed to create review session"` |

All tool handlers must wrap DB operations in `try/catch` and return `Result<T, E>` from repository functions. Never let a DB exception propagate as an unhandled rejection.

### 3.4 Performance

- New tables will have at most tens of thousands of rows in typical usage. No partitioning required.
- `(owner, repo, aiTool)` unique index on `repo_review_configs` provides O(log n) lookup.
- `sessionId` index on `review_session_drafts` ensures draft fetch is bounded by the number of AI tools (at most 3 per session).

---

## 4. Data Models — Drizzle Schema Additions

Add to `src/backend/db/schema.ts`:

### `repoReviewConfigsTable`

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
    ownerRepoToolUnique: uniqueIndex("repo_review_configs_owner_repo_tool_unique")
      .on(table.owner, table.repo, table.aiTool),
  })
);
```

### `reviewSessionsTable`

```typescript
export const reviewSessionsTable = sqliteTable("review_sessions", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
  prNumber: integer("pr_number").notNull(),
  status: text("status").notNull().default("pending"), // pending | reviewing | synthesising | completed | failed
  errorMessage: text("error_message"), // nullable
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"), // nullable
});
```

### `reviewSessionDraftsTable`

```typescript
export const reviewSessionDraftsTable = sqliteTable("review_session_drafts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => reviewSessionsTable.id),
  agentId: text("agent_id").notNull(),
  aiTool: text("ai_tool").notNull(), // "claude" | "gemini" | "codex"
  runId: text("run_id"), // nullable
  verdict: text("verdict").notNull(), // APPROVE | REQUEST_CHANGES | COMMENT
  body: text("body").notNull(),
  commentsJson: text("comments_json").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});
```

---

## 5. Zod Schemas

Add to `src/shared/schemas/` (new files):

### `repo-review-config.schema.ts`

```typescript
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

export const SetRepoReviewConfigInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  aiTool: AiToolSchema,
  enabled: z.boolean(),
  agentId: z.string().min(1).optional(),
  requiresExplicitSelection: z.boolean().optional(),
});
```

### `review-session.schema.ts`

```typescript
export const ReviewSessionStatusSchema = z.enum([
  "pending",
  "reviewing",
  "synthesising",
  "completed",
  "failed",
]);
export type ReviewSessionStatus = z.infer<typeof ReviewSessionStatusSchema>;

export const ReviewVerdictSchema = z.enum(["APPROVE", "REQUEST_CHANGES", "COMMENT"]);
export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>;

export const CommentCategorySchema = z.enum([
  "bug", "security", "performance", "style", "test", "docs", "other",
]);
export type CommentCategory = z.infer<typeof CommentCategorySchema>;

export const DraftCommentSchema = z.object({
  path: z.string().min(1),
  position: z.number().int().positive(),
  body: z.string().min(1),
  category: CommentCategorySchema,
});
export type DraftComment = z.infer<typeof DraftCommentSchema>;

export const StoreAgentReviewDraftInputSchema = z.object({
  sessionId: z.string().min(1),
  agentId: z.string().min(1),
  aiTool: AiToolSchema,
  runId: z.string().nullable().optional(),
  verdict: ReviewVerdictSchema,
  body: z.string().min(1),
  comments: z.array(DraftCommentSchema).default([]),
});

export const GetReviewSessionDraftsInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const StartPrReviewSessionInputSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
});

export const ConsolidatedCommentSchema = z.object({
  path: z.string().min(1),
  position: z.number().int().positive(),
  body: z.string().min(1),
});

export const PublishConsolidatedReviewInputSchema = z.object({
  sessionId: z.string().min(1),
  owner: z.string().min(1),
  repo: z.string().min(1),
  prNumber: z.number().int().positive(),
  verdict: ReviewVerdictSchema,
  body: z.string().min(1),
  comments: z.array(ConsolidatedCommentSchema).default([]),
});
```

---

## 6. Branded Types

Add to `src/shared/types.ts`:

```typescript
export type ReviewSessionId = Brand<string, "ReviewSessionId">;
export type ReviewSessionDraftId = Brand<string, "ReviewSessionDraftId">;
export type RepoReviewConfigId = Brand<string, "RepoReviewConfigId">;

export function createReviewSessionId(value: string): ReviewSessionId {
  return value as ReviewSessionId;
}
export function createReviewSessionDraftId(value: string): ReviewSessionDraftId {
  return value as ReviewSessionDraftId;
}
export function createRepoReviewConfigId(value: string): RepoReviewConfigId {
  return value as RepoReviewConfigId;
}
```

---

## 7. File Impact Summary

### New Files (14)

| # | Area | File | Purpose |
|---|---|---|---|
| 1 | Schema | `src/shared/schemas/repo-review-config.schema.ts` | Zod schemas for repo config types |
| 2 | Schema | `src/shared/schemas/review-session.schema.ts` | Zod schemas for session, draft, and tool inputs |
| 3 | Repository | `src/backend/db/repositories/repo-review-configs.repository.ts` | CRUD for `repo_review_configs` table |
| 4 | Repository | `src/backend/db/repositories/review-sessions.repository.ts` | CRUD + status transitions for `review_sessions` |
| 5 | Repository | `src/backend/db/repositories/review-session-drafts.repository.ts` | Upsert + retrieval for `review_session_drafts` |
| 6 | Tool | `src/backend/tools/github/get-repo-review-config.tool.ts` | MCP tool: `get_repo_review_config` |
| 7 | Tool | `src/backend/tools/github/set-repo-review-config.tool.ts` | MCP tool: `set_repo_review_config` |
| 8 | Tool | `src/backend/tools/github/start-pr-review-session.tool.ts` | MCP tool: `start_pr_review_session` |
| 9 | Tool | `src/backend/tools/github/store-agent-review-draft.tool.ts` | MCP tool: `store_agent_review_draft` |
| 10 | Tool | `src/backend/tools/github/get-review-session-drafts.tool.ts` | MCP tool: `get_review_session_drafts` |
| 11 | Tool | `src/backend/tools/github/publish-consolidated-review.tool.ts` | MCP tool: `publish_consolidated_review` |
| 12 | Agent | `src/backend/agents/review-synthesiser.agent.ts` | Synthesiser agent definition |
| 13 | Test | `src/backend/db/repositories/review-sessions.repository.test.ts` | Unit tests: session repo |
| 14 | Test | `src/backend/tools/github/start-pr-review-session.tool.test.ts` | Integration tests: coordinator flow |

### Modified Files (5)

| # | File | Change |
|---|---|---|
| 1 | `src/backend/db/schema.ts` | Add `repoReviewConfigsTable`, `reviewSessionsTable`, `reviewSessionDraftsTable` |
| 2 | `src/shared/types.ts` | Add `ReviewSessionId`, `ReviewSessionDraftId`, `RepoReviewConfigId` branded types + creators |
| 3 | `src/backend/agents/index.ts` | Export `review-synthesiser` agent |
| 4 | `src/backend/server.ts` | Register 6 new MCP tools, new repos, new agent — wire all deps |
| 5 | `src/backend/agents/engine/tool-handler-registry.ts` | Register 6 new tools in the engine registry (so synthesiser agent can call them) |

---

## 8. Acceptance Criteria (BDD)

### REQ-7.1 — Configuration

**Given** a repository has no config rows
**When** `start_pr_review_session` is called for that repo
**Then** three default config rows are created (`claude` enabled, `gemini` enabled, `codex` disabled) and the session is created using those defaults

**Given** `set_repo_review_config` is called with `aiTool: "codex"` and `enabled: true` but without `requiresExplicitSelection: false`
**When** the tool processes the input
**Then** it returns `isError: true` with message indicating codex requires explicit opt-in

**Given** an existing config row for `(owner, repo, claude)`
**When** `set_repo_review_config` is called with `enabled: false` for that combination
**Then** the `enabled` column is updated to `0` and `updatedAt` is refreshed

---

### REQ-7.2 — Session and Draft Storage

**Given** a valid review session in `reviewing` status
**When** `store_agent_review_draft` is called with `aiTool: "claude"` and valid draft data
**Then** a draft row is created and `{ draftId, sessionId, aiTool, commentCount }` is returned

**Given** a draft already exists for `(sessionId, aiTool: "claude")`
**When** `store_agent_review_draft` is called again for the same session+aiTool
**Then** the existing draft is overwritten (upsert) and the tool returns success

**Given** a session with `status: "completed"`
**When** `store_agent_review_draft` is called for that session
**Then** the tool returns `isError: true` with `"Session is already closed"`

**Given** a session with three stored drafts (claude, gemini, codex)
**When** `get_review_session_drafts` is called
**Then** all three drafts are returned with parsed `comments` arrays ordered by `createdAt ASC`

---

### REQ-7.3 — Synthesiser Agent

**Given** the `review-synthesiser` agent is running with a valid `sessionId`
**When** it calls `get_review_session_drafts`
**Then** it receives all draft bodies and comment arrays in the response

**Given** two drafts have comments with the same `path`, `position`, and `category`
**When** the synthesiser processes them
**Then** the consolidated review contains one comment at that position with both AI tools attributed

**Given** draft A has verdict `APPROVE` and draft B has verdict `REQUEST_CHANGES`
**When** the synthesiser determines the consolidated verdict
**Then** the consolidated verdict is `REQUEST_CHANGES`

**Given** the synthesiser has composed the consolidated review
**When** it calls `publish_consolidated_review`
**Then** the GitHub review is posted and the session status becomes `completed`

---

### REQ-7.4 — Publishing

**Given** a consolidated review with 2 valid and 1 invalid (position = 0) inline comments
**When** `publish_consolidated_review` processes the comments
**Then** only 2 comments are posted, `commentsDropped: 1` is returned, and a warning is logged

**Given** the GitHub API returns an error during `publish_consolidated_review`
**When** the tool handles the failure
**Then** the session status is set to `failed`, an error message is stored, and the tool returns `isError: true` with a sanitised message

---

### REQ-7.5 — Coordinator Entry Point

**Given** a repo with claude and gemini enabled, codex disabled
**When** `start_pr_review_session` is called for a PR in that repo
**Then** a session is created with `status: reviewing` and `enabledAgents` contains exactly 2 entries (claude, gemini)

**Given** a session already exists for `(owner, repo, prNumber)` with `status: reviewing`
**When** `start_pr_review_session` is called for the same PR
**Then** the existing session is returned without creating a duplicate

**Given** a repo where all AI tools are disabled
**When** `start_pr_review_session` is called
**Then** the tool returns `isError: true` and no session row is created

---

## 9. Out of Scope (Phase 2)

- **Frontend admin panel changes** — no UI for repo review config or session history in Phase 2. API-only. UI is Phase 3.
- **AI API key management on the server** — simple-mcp never stores or uses Gemini or Codex API keys.
- **Automatic subprocess spawning** — simple-mcp does not launch `gemini` or `codex` CLI processes. The external coordinator does.
- **Automatic polling / fan-out orchestration** — simple-mcp returns the session + agent list and the external client coordinates.
- **Webhook-triggered reviews** — GitHub webhook integration to auto-trigger reviews on PR open/update is a future phase.
- **Changes to the existing `github_submit_review` tool** — that tool remains for direct (non-session) review submission. It is not replaced.
- **Review diff position validation against the actual GitHub diff** — positions are accepted as-is from the reviewing agents; invalid positions are silently dropped at publish time. Full validation against the live diff is a future enhancement.
