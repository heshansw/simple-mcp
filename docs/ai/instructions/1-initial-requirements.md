# 1 — Initial Requirements

> **Status:** Draft
> **Created:** 2026-03-16

---

## 1. Project Purpose

Build a **local MCP (Model Context Protocol) server** that acts as a central hub for managing and connecting with external integrations (Jira, GitHub, and others), with a **React admin panel** for configuration, and a **pre-defined agent system** that users can configure and deploy from the UI.

This is a single self-contained project — everything runs locally on the developer's machine.

---

## 2. High-Level Requirements

### REQ-1: Local MCP Server

A fully functional MCP server running locally that:

- Implements the Model Context Protocol using `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`.
- Exposes tools, resources, and prompts over standard MCP transports (stdio, SSE, Streamable HTTP).
- Manages connections to external services (Jira, GitHub, and extensible to others).
- Handles authentication, token storage, and credential management for each integration.
- Automatically maintains and updates its own state (connection health, token refresh, schema sync) based on the privileges granted by each integration.
- Runs as a single local process that MCP clients (Claude Desktop, Claude Code, IDEs) can connect to.

### REQ-2: Admin Panel

A React 19 web-based management panel that:

- Provides a UI to add, edit, remove, and test integration connections (Jira, GitHub, etc.).
- Displays connection status, health checks, and last-sync timestamps for each integration.
- Manages secrets and credentials (API keys, OAuth tokens) — stored encrypted, never exposed in the UI after initial entry.
- Allows configuration of server-level settings (transport mode, logging level, rate limits).
- Communicates with the backend via a typed REST/HTTP API (not directly over MCP).
- Uses TanStack Router for routing and TanStack Query for server state management.

### REQ-3: Self-Maintaining Server

The MCP server must automatically:

- Refresh expired OAuth tokens before they lapse.
- Re-validate connection health on a configurable interval.
- Sync integration schemas/metadata (e.g., Jira project list, GitHub repo list) when permissions change.
- Gracefully degrade when an integration is unreachable — disable affected tools, surface status in admin panel, retry with backoff.
- Log all maintenance activity with structured logging (pino).

### REQ-4: Pre-Defined Agent System

A system of pre-configured, task-specific agents that:

- Ship with the project as a built-in library of agent definitions (e.g., "Jira Triage Agent", "PR Review Agent", "Sprint Planning Agent", "Code Search Agent").
- Each agent definition includes: name, description, required integrations, required tools, system prompt/instructions, and configurable parameters.
- Agents are **not** autonomous processes — they are **MCP prompt templates + tool bundles** that MCP clients can invoke.
- From the admin panel, the user can:
  - Browse all available pre-defined agents.
  - Enable/disable individual agents.
  - Configure agent parameters (e.g., which Jira project to target, which GitHub repos to watch).
  - Connect agents to specific integration instances (e.g., "PR Review Agent" → "my-github-org" connection).
  - View which tools and integrations each agent requires, and whether those dependencies are satisfied.
- Agent definitions are extensible — new agents can be added by creating a new definition file following the established pattern.

### REQ-5: Source Structure

**All source code resides inside the `src/` folder** at the project root. No `packages/` directory — this is a single-project monorepo with internal path aliases:

```
claude_mcp/
├── src/
│   ├── cli.ts                    # CLI entry point — arg parsing, command routing
│   ├── cli/                      # CLI commands and daemon management
│   │   ├── commands/
│   │   │   ├── start.command.ts
│   │   │   ├── stop.command.ts
│   │   │   ├── status.command.ts
│   │   │   └── config.command.ts
│   │   └── daemon.ts             # PID file management, background process
│   ├── backend/                  # MCP server core
│   │   ├── server.ts             # Entry point — bootstrap MCP server
│   │   ├── tools/                # MCP tool definitions (one file per tool)
│   │   │   ├── jira/             # Jira-specific tools
│   │   │   │   ├── search-issues.tool.ts
│   │   │   │   ├── create-issue.tool.ts
│   │   │   │   └── transition-issue.tool.ts
│   │   │   ├── github/           # GitHub-specific tools
│   │   │   │   ├── list-prs.tool.ts
│   │   │   │   ├── review-pr.tool.ts
│   │   │   │   └── search-code.tool.ts
│   │   │   └── system/           # Server management tools
│   │   │       ├── health-check.tool.ts
│   │   │       └── list-connections.tool.ts
│   │   ├── resources/            # MCP resource definitions
│   │   ├── prompts/              # MCP prompt definitions
│   │   ├── transports/           # stdio, SSE, Streamable HTTP adapters
│   │   ├── middleware/           # Auth, rate-limit, logging, error handling
│   │   ├── services/             # Business logic, API clients per integration
│   │   │   ├── jira.service.ts
│   │   │   ├── github.service.ts
│   │   │   └── connection-manager.service.ts
│   │   ├── agents/               # Pre-defined agent definitions
│   │   │   ├── registry.ts       # Agent registry — discovers and loads definitions
│   │   │   ├── types.ts          # AgentDefinition type, AgentConfig schema
│   │   │   ├── jira-triage.agent.ts
│   │   │   ├── pr-review.agent.ts
│   │   │   ├── sprint-planning.agent.ts
│   │   │   └── code-search.agent.ts
│   │   ├── db/                   # Embedded SQLite database layer
│   │   │   ├── client.ts         # Database connection (better-sqlite3 + Drizzle)
│   │   │   ├── schema.ts         # Drizzle table definitions
│   │   │   ├── migrate.ts        # Auto-run migrations on startup
│   │   │   ├── repositories/     # Typed repository functions per table
│   │   │   └── migrations/       # Drizzle-kit generated SQL migrations
│   │   ├── config/               # Server config, env validation
│   │   │   └── env.schema.ts     # Zod schema for environment variables
│   │   └── maintenance/          # Auto-maintenance: token refresh, health checks, sync
│   │       ├── scheduler.ts      # Cron-like task scheduler
│   │       ├── token-refresh.ts  # OAuth token lifecycle management
│   │       ├── health-monitor.ts # Connection health polling
│   │       └── schema-sync.ts    # Integration metadata sync
│   ├── frontend/                 # React 19 admin panel
│   │   ├── main.tsx              # App entry point
│   │   ├── app.tsx               # Root component, providers, router
│   │   ├── routes/               # TanStack Router file-based routes
│   │   │   ├── __root.tsx
│   │   │   ├── index.tsx         # Dashboard — overview of connections + agents
│   │   │   ├── connections/      # Integration management pages
│   │   │   │   ├── index.tsx     # List all connections
│   │   │   │   ├── $connectionId.tsx  # Edit single connection
│   │   │   │   └── new.tsx       # Add new connection
│   │   │   ├── agents/           # Agent configuration pages
│   │   │   │   ├── index.tsx     # Browse all pre-defined agents
│   │   │   │   └── $agentId.tsx  # Configure single agent
│   │   │   └── settings/         # Server settings pages
│   │   │       └── index.tsx
│   │   ├── components/           # UI components (flat, no barrel files)
│   │   ├── hooks/                # Custom hooks
│   │   ├── api/                  # TanStack Query hooks + typed API client
│   │   │   ├── client.ts         # Typed HTTP client
│   │   │   ├── query-keys.ts     # Centralized query key definitions
│   │   │   ├── connections.api.ts
│   │   │   └── agents.api.ts
│   │   └── stores/               # Zustand stores (only if needed)
│   ├── shared/                   # Types, schemas, utilities shared across backend + frontend
│   │   ├── types.ts              # Branded types, domain types, utility types
│   │   ├── result.ts             # Result<T, E> type + Ok/Err helpers
│   │   └── schemas/              # Zod schemas (single source of truth)
│   │       ├── connection.schema.ts   # ConnectionConfig, ConnectionStatus
│   │       ├── agent.schema.ts        # AgentDefinition, AgentConfig
│   │       ├── integration.schema.ts  # Integration-specific schemas (Jira, GitHub)
│   │       └── server.schema.ts       # Server settings, health status
│   └── __tests__/                # Test files (mirrors src structure)
│       ├── backend/
│       ├── frontend/
│       └── shared/
├── docs/
│   └── ai/
│       ├── agents/               # AI agent persona instructions
│       └── instructions/         # Requirement/instruction files (this file)
├── CLAUDE.md                     # Project-level AI assistant instructions
├── package.json
├── tsconfig.json
└── vite.config.ts                # Vite for frontend build + dev server
```

### REQ-6: Embedded Database for Configuration Management

All application state — connection configs, agent settings, credentials, health status, sync metadata — must be stored in a **lightweight, embedded, file-based database** that ships with the app. No external database server required.

- Use **SQLite** via `better-sqlite3` (synchronous, fast, zero-config) as the embedded database engine.
- Use **Drizzle ORM** as the type-safe query layer — Zod-compatible schema definitions, zero runtime overhead, SQL-first approach.
- The database file lives in a configurable data directory (default: `~/.simple-mcp/data.db`).
- Database schema managed via Drizzle migrations (`drizzle-kit`) — auto-run on startup if pending.
- All database access goes through a typed repository layer — no raw SQL in services or handlers.

#### Database Tables

| Table | Purpose |
|---|---|
| `connections` | Integration connection configs (type, name, base URL, auth method, status, created/updated timestamps) |
| `credentials` | Encrypted secrets (API keys, OAuth tokens, refresh tokens) — linked to a connection by FK |
| `agent_configs` | Per-agent user configuration (enabled/disabled, parameter overrides, linked connection IDs) |
| `server_settings` | Key-value store for server-level config (transport mode, log level, admin panel port, etc.) |
| `sync_metadata` | Last sync timestamps, cached integration metadata (project lists, repo lists) per connection |
| `audit_log` | Append-only log of config changes, token refreshes, connection state transitions |

#### Repository Pattern

```typescript
// src/backend/db/repositories/connections.repository.ts
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../client.ts";
import { connections } from "../schema.ts";

export function createConnectionsRepository(db: DrizzleDB) {
  return {
    findAll: () => db.select().from(connections),
    findById: (id: ConnectionId) =>
      db.select().from(connections).where(eq(connections.id, id)),
    create: (data: NewConnection) =>
      db.insert(connections).values(data).returning(),
    update: (id: ConnectionId, data: Partial<NewConnection>) =>
      db.update(connections).set(data).where(eq(connections.id, id)).returning(),
    delete: (id: ConnectionId) =>
      db.delete(connections).where(eq(connections.id, id)),
  };
}
```

#### Source Structure

```
src/backend/db/
├── client.ts                # Database connection setup (better-sqlite3 + Drizzle)
├── schema.ts                # Drizzle table definitions (single source of truth)
├── migrate.ts               # Auto-run migrations on startup
├── repositories/
│   ├── connections.repository.ts
│   ├── credentials.repository.ts
│   ├── agent-configs.repository.ts
│   ├── server-settings.repository.ts
│   └── sync-metadata.repository.ts
└── migrations/              # Drizzle-kit generated SQL migrations
    └── 0000_initial.sql
```

#### Database Rules

- **Credentials column is always encrypted** — encrypt before write, decrypt on read. Never store plaintext secrets.
- **Migrations run automatically on server startup** — no manual migration steps.
- **Database file is excluded from git** (`.gitignore`).
- **Repository functions return typed results** — Drizzle infers types from the schema.
- **No raw SQL outside the `db/` directory** — all access via repositories.
- **WAL mode enabled** for concurrent read performance.
- **Backup on startup** — copy `data.db` to `data.db.bak` before running migrations.

### REQ-7: Installable CLI with Alias

The project must be runnable as a **locally installed CLI tool** via a short alias — not just `pnpm dev` from the repo directory. It should feel like an installed application:

- Define a `bin` entry in `package.json` that exposes a CLI command (e.g., `simple-mcp`).
- After running `pnpm install -g .` (or `npm link`), the user can start the entire stack from anywhere:
  ```bash
  simple-mcp start        # Start MCP server + admin panel
  simple-mcp start --server-only   # Start MCP server without admin panel
  simple-mcp start --admin-only    # Start admin panel only
  simple-mcp stop          # Gracefully stop all running processes
  simple-mcp status        # Show running status, active connections, enabled agents
  simple-mcp config        # Open admin panel in default browser
  ```
- The CLI entry point lives at `src/cli.ts` and is the top-level orchestrator.
- The CLI must:
  - Parse commands and flags (use a lightweight arg parser — no heavy frameworks).
  - Bootstrap the MCP server and/or admin panel based on the command.
  - Support running as a background daemon (`simple-mcp start --daemon`) with PID file management.
  - Print connection info on start (e.g., `MCP server listening on stdio`, `Admin panel at http://localhost:3100`).
  - Handle `SIGINT` / `SIGTERM` for graceful shutdown.
- The `package.json` bin entry:
  ```json
  {
    "bin": {
      "simple-mcp": "./dist/cli.js"
    }
  }
  ```
- The project build step (`pnpm build`) must produce a runnable `dist/cli.js` with a proper `#!/usr/bin/env node` shebang.
- The CLI source file structure:
  ```
  src/
  ├── cli.ts                # CLI entry point — arg parsing, command routing
  ├── cli/
  │   ├── commands/
  │   │   ├── start.command.ts    # Start server/admin/both
  │   │   ├── stop.command.ts     # Graceful shutdown
  │   │   ├── status.command.ts   # Show running state
  │   │   └── config.command.ts   # Open admin panel in browser
  │   └── daemon.ts               # PID file management, background process handling
  ```

---

## 3. Integration Requirements

### Jira Integration

| Capability | Description |
|---|---|
| Authentication | OAuth 2.0 (Atlassian Cloud) or API token (Server/DC) |
| Tools | Search issues, create issue, update issue, transition issue, get sprint, add comment |
| Resources | Project list, board list, sprint list, issue type schemas |
| Auto-sync | Project metadata, custom field definitions, workflow transitions |

### GitHub Integration

| Capability | Description |
|---|---|
| Authentication | GitHub App or Personal Access Token |
| Tools | List PRs, review PR, search code, list issues, create issue, get repo info |
| Resources | Repository list, organization members, branch protection rules |
| Auto-sync | Repository list, team permissions, webhook status |

### Future Integrations (Extensible)

The integration system must be designed so adding a new integration requires:

1. A new service file (`src/backend/services/<name>.service.ts`).
2. New tool files (`src/backend/tools/<name>/*.tool.ts`).
3. A connection schema entry (`src/shared/schemas/integration.schema.ts`).
4. An admin panel route (auto-discovered or minimal wiring).

No changes to core server code should be needed to add a new integration.

---

## 4. Agent Definition Structure

Each pre-defined agent is a single file following this structure:

```typescript
// src/backend/agents/pr-review.agent.ts
import { z } from "zod";
import type { AgentDefinition } from "./types.ts";

export const prReviewAgent: AgentDefinition = {
  id: "pr-review",
  name: "PR Review Agent",
  description: "Reviews pull requests for code quality, type safety, and adherence to project standards.",
  version: "1.0.0",

  // Which integrations this agent needs
  requiredIntegrations: ["github"],

  // Which MCP tools this agent uses
  requiredTools: [
    "github:list-prs",
    "github:review-pr",
    "github:search-code",
  ],

  // Configurable parameters (validated by Zod, edited in admin panel)
  configSchema: z.object({
    targetRepos: z.array(z.string()).min(1).describe("GitHub repos to watch"),
    reviewCriteria: z.array(z.string()).default([
      "type-safety",
      "error-handling",
      "naming-conventions",
    ]).describe("What to focus on during review"),
    autoApprove: z.boolean().default(false).describe("Auto-approve if no issues found"),
  }),

  // System prompt / instructions for MCP clients
  systemPrompt: `You are a senior code reviewer. Review the given PR for:
- Type safety issues (any leaks, unsafe assertions)
- Error handling (Result types, exhaustive switches)
- Naming conventions and file structure
- Test coverage for changed code
Provide actionable feedback with specific line references.`,
};
```

---

## 5. Non-Functional Requirements

| Concern | Requirement |
|---|---|
| **Startup time** | Server must be ready to accept MCP connections within 3 seconds |
| **Database** | Embedded SQLite via `better-sqlite3` + Drizzle ORM — zero external dependencies, auto-migrations on startup |
| **Secret storage** | All credentials encrypted at rest (AES-256) in the database — never plaintext |
| **Logging** | Structured JSON logs (pino), configurable log level, no secrets in logs |
| **Error resilience** | Single integration failure must not crash the server or affect other integrations |
| **Transport support** | stdio (default for Claude Desktop), SSE, and Streamable HTTP |
| **Frontend dev** | Vite dev server with HMR, proxied to backend API |
| **Type safety** | End-to-end type safety from Zod schema → backend handler → API response → frontend query |
| **Offline tolerance** | Server starts and serves cached data even if integrations are unreachable |

---

## 6. Constraints

1. **All source files live under `src/`** — no top-level `packages/` directory.
2. **Single `package.json`** at the root — use TypeScript path aliases (`@backend/*`, `@frontend/*`, `@shared/*`) instead of workspace packages.
3. **No `any` types** — use `unknown` + narrowing everywhere.
4. **No default exports** — named exports only.
5. **`McpServer` only** — never use the deprecated `Server` from `@modelcontextprotocol/sdk/server/index.js`.
6. **Zod as single source of truth** — all data shapes defined as Zod schemas, TypeScript types inferred with `z.infer`.
7. **Result types for expected failures** — no throwing for business logic errors.
8. **Semantic commits** — `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`.

---

## 7. Out of Scope (For Now)

- Multi-user / multi-tenant support — this is a single-user local tool.
- Cloud deployment or hosted mode.
- Custom agent creation from the UI (agents are code-defined only for now).
- Plugin/extension marketplace.
- External database server (PostgreSQL, MySQL, etc.) — SQLite is the embedded DB.

---

## 8. Success Criteria

1. Running `pnpm dev` starts both the MCP server and the admin panel dev server.
2. Claude Desktop / Claude Code can connect to the MCP server and list available tools.
3. A user can add a Jira connection via the admin panel, and Jira tools become available to MCP clients.
4. A user can enable the "PR Review Agent" in the admin panel, connect it to a GitHub integration, and MCP clients can invoke it.
5. Expired OAuth tokens are refreshed automatically without user intervention.
6. If GitHub goes down, Jira tools continue to work normally.
7. After `pnpm build && pnpm install -g .`, running `simple-mcp start` from any directory starts the full stack.
8. `simple-mcp status` shows active connections and enabled agents.
