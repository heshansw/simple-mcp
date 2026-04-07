---
name: Pending Feature Requirements
description: Features specified but not yet implemented in simple-mcp — local filesystem access and local database connections
type: project
---

Three features have been spec'd and documented in `docs/ai/instructions/`. All are pending implementation.

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
