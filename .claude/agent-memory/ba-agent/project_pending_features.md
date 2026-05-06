---
name: Pending Feature Requirements
description: Features specified but not yet implemented in simple-mcp — local filesystem access, local database connections, and unified review config + code review
type: project
---

Features spec'd and documented. Features 3-5 and 8 are implemented. Feature 9 (Google Meet) is implemented.

**Feature 9 — Google Meet Transcription Integration** (implemented 2026-05-05)
New unified `"google"` connection type (renamed from `"google-calendar"`). Shares OAuth connection with Calendar, adds Meet scopes (`meetings.space.readonly`). 5 new MCP tools: `google_meet_check_prerequisites`, `google_meet_list_meetings`, `google_meet_get_transcript`, `google_meet_search_transcripts`, `google_meet_sync_transcripts`. Auto-polling transcript sync (30min interval) stores encrypted transcripts in `meet_transcripts` table with FTS5 full-text search. New `meeting-summarizer` agent for transcript analysis.

**Why:** Developer request to surface Google Meet transcripts for Claude agents to summarize meetings, extract action items, and search across meeting history.

**How it was applied:** `google-calendar` integration type renamed to `google` across all files. Shared `GoogleTokenBundle` extracted to `@shared/schemas/google-common.schema.ts`. New service at `src/backend/services/google-meet.service.ts`, tools in `src/backend/tools/google-meet/`, maintenance task at `src/backend/maintenance/transcript-sync.ts`, repository at `src/backend/db/repositories/meet-transcripts.repository.ts`.

---

**Feature 10 — Local Audio Capture + Whisper Transcription** (spec'd 2026-05-06, pending implementation)
Chrome extension captures meeting tab audio via `chrome.tabCapture`, sends to MCP server which transcribes with `whisper.cpp`. Stores encrypted transcripts in `audio_transcripts` table with FTS5 search. Analysis results (summaries, action items, Jira/GitHub cross-refs) stored in `meeting_analyses` table. Frontend dashboard at `/meetings` with list + detail views. 7 MCP tools. Full plan in `.claude/plans/deep-beaming-rabin.md`.

**Why:** Google Meet API requires GCP + paid Workspace + host-enabled transcription. This works for ALL meetings with no cloud dependencies.

---

Three earlier features were spec'd and documented in `docs/ai/instructions/`.

**Feature 3 — Local Repository / Folder Access** (`3-local-repo-access-requirements.md`)
New integration type `"local-filesystem"`. Admins register local folder paths; agents get read-only MCP tools (`fs_read_file`, `fs_list_directory`, `fs_search_files`, `fs_get_file_tree`). Includes multi-repo **Workspace** grouping (`repo_workspaces` table) with cross-repo tools (`fs_workspace_search`, `fs_workspace_tree`). Path traversal sandboxing is a critical security requirement.

**Why:** Developer request to let Claude agents reason over local codebases without pushing to remote services. Multi-repo workspace extension added in same session for microservice/monorepo use cases.

**How to apply:** When implementing, new DB tables are `folder_access` and `repo_workspaces` (not extending `connectionsTable`). New npm dep: `fast-glob`. No auth/credentials needed.

---

**Feature 4 — Local Database Connections (MySQL + PostgreSQL)** (`4-local-database-connections-requirements.md`)
New integration types `"mysql"` and `"postgres"`. Credentials (host/port/user/pass or connection string) stored AES-256 encrypted in existing `credentialsTable`. New tools: `db_query`, `db_list_schemas`, `db_list_tables`, `db_describe_table`. `db_query` is read-only by default; writes opt-in per-connection. DDL always blocked regardless of write setting.

**Why:** Developer request to allow Claude agents to query local DB instances for data analysis and schema documentation.

**How to apply:** New npm deps `mysql2` and `pg`. Extends existing `connectionsTable` with two nullable columns (`database_dialect`, `allow_writes`) via migration — no new table needed. New auth method values: `"connection_string"` and `"username_password"`.

---

**Feature 5 — Confluence Integration** (`5-confluence-requirements.md`)
Read-only. 3 tools: `confluence_search_pages` (CQL), `confluence_get_page` (returns Markdown), `confluence_list_spaces`. Reuses the existing Jira connection's `getConnectionInfo()` — no new connection type or credentials. Space allowlist stored in existing `serverSettingsTable` under key `confluence.allowed_space_keys`. New npm dep: `node-html-markdown` for storage-format-to-Markdown conversion.

**Why:** User wants agents to read Confluence documentation to answer questions. Q1 confirmed reuse of Jira connection; Q2 read-only; Q3 Markdown output; Q4 admin-configurable space allowlist; Q5 agent reads docs.

**How to apply:** No schema changes. No new table. The `integrationType` enum is NOT extended — Confluence is not its own connection type. Space allowlist enforced silently via CQL injection on search and post-fetch check on get-page.

---

**Feature 8 — Unified Review Config + Local Code Review** (`8-unified-review-config-and-code-review-requirements.md`, spec'd 2026-04-30)

Two coupled features that must be implemented together as a single migration.

**Feature A — Unified Review Config:** Breaks the `repo_review_configs` unique constraint from `(owner, repo, aiTool)` to `(owner, repo, agentId, aiTool)`. Allows multiple agents per AI tool per repo (e.g. Claude running both `backend-pr-reviewer` and `security-reviewer`). New default set is 5 rows (not 3). New tools: `add_repo_review_agent`, `remove_repo_review_agent`. Breaking change: `agentId` becomes required in `set_repo_review_config`. `store_agent_review_draft` upsert key changes from `(sessionId, aiTool)` to `(sessionId, agentId, aiTool)`.

**Feature B — Local Code Review:** New flow for reviewing local git diffs (staged/unstaged/branch). New tables: `code_review_sessions`, `code_review_drafts` (separate tables, not a discriminator on existing session tables — decision rationale in doc section 3). New tools: `start_code_review_session`, `publish_code_review_report`, `get_code_review_session_drafts`. Extends `store_agent_review_draft` with optional `codeReviewSessionId` (XOR with `sessionId`). Uses same `repo_review_configs` table and same `review-synthesiser` agent. Admin panel gains `/code-reviews` and `/code-reviews/:sessionId` routes.

**Why:** Single agent per AI tool was too restrictive for multi-specialist review patterns. Local code review enables pre-commit review without a GitHub PR.

**How to apply:** Migration must drop old unique index and create new one on `repo_review_configs`. Existing data is valid under new constraint. Git diff runs via `spawnSync` (not shell exec) with 30s timeout and 500 KB size limit. `reportMarkdown` stored in `code_review_sessions`, returned verbatim to terminal for rendering.
