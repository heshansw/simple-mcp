# CLAUDE.md — Project Instructions

## Project Overview

This is a **TypeScript monorepo** containing:

1. **Backend** — An MCP (Model Context Protocol) server implementation using `@modelcontextprotocol/sdk`, exposing tools, resources, and prompts over JSON-RPC (stdio, SSE, HTTP).
2. **Frontend** — A React 19 management panel (TanStack Router + TanStack Query) for configuring MCP server settings, connections (Jira, GitHub, etc.), secrets, and runtime config.
3. **Shared** — Common TypeScript types, Zod schemas, and utilities consumed by both backend and frontend.

---

## Project Structure

All source code lives under `src/`. Single `package.json` at root with TypeScript path aliases — no `packages/` directory.

```
claude_mcp/
├── src/
│   ├── cli.ts                    # CLI entry point (bin: simple-mcp)
│   ├── cli/                      # CLI commands + daemon management
│   │   ├── commands/             # start, stop, status, config commands
│   │   └── daemon.ts             # PID file, background process handling
│   ├── backend/                  # MCP server core
│   │   ├── server.ts             # Entry point — bootstrap MCP server
│   │   ├── tools/                # MCP tool definitions (one file per tool)
│   │   │   ├── jira/             # Jira-specific tools
│   │   │   ├── github/           # GitHub-specific tools
│   │   │   └── system/           # Server management tools
│   │   ├── resources/            # MCP resource definitions
│   │   ├── prompts/              # MCP prompt definitions
│   │   ├── transports/           # stdio, SSE, Streamable HTTP adapters
│   │   ├── middleware/           # Auth, rate-limit, logging, error handling
│   │   ├── services/             # Business logic, API clients per integration
│   │   ├── agents/               # Pre-defined agent definitions + registry
│   │   ├── db/                   # Embedded SQLite (better-sqlite3 + Drizzle ORM)
│   │   │   ├── client.ts         # DB connection setup
│   │   │   ├── schema.ts         # Drizzle table definitions
│   │   │   ├── repositories/     # Typed repository functions per table
│   │   │   └── migrations/       # Drizzle-kit generated SQL migrations
│   │   ├── config/               # Server config, env validation
│   │   └── maintenance/          # Auto-maintenance: token refresh, health, sync
│   ├── frontend/                 # React 19 admin panel
│   │   ├── main.tsx              # App entry point
│   │   ├── app.tsx               # Root component, providers, router
│   │   ├── routes/               # TanStack Router file-based routes
│   │   ├── components/           # UI components (flat, no barrel files)
│   │   ├── hooks/                # Custom hooks
│   │   ├── api/                  # TanStack Query hooks + typed API client
│   │   └── stores/               # Zustand stores (only if needed)
│   ├── shared/                   # Types, schemas, utilities shared across both
│   │   ├── types.ts              # Branded types, domain types, utility types
│   │   ├── result.ts             # Result<T, E> type + Ok/Err helpers
│   │   └── schemas/              # Zod schemas (single source of truth)
│   └── __tests__/                # Test files (mirrors src structure)
├── docs/ai/                      # AI agent instructions + requirement docs
├── CLAUDE.md
├── package.json                  # Single root package.json
├── tsconfig.json                 # Path aliases: @backend/*, @frontend/*, @shared/*
└── vite.config.ts                # Vite for frontend build + dev server
```

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js 20+ | Native ESM, stable fetch |
| Language | TypeScript 5.x | `strict: true`, always |
| MCP SDK | `@modelcontextprotocol/sdk` | Use `McpServer` from `server/mcp.js` (NOT the deprecated `Server` from `server/index.js`) |
| Schema validation | Zod | Runtime + static types from one schema |
| Frontend framework | React 19 | Function components only, no class components |
| Routing | TanStack Router | File-based, type-safe routing |
| Server state | TanStack Query | Cache, invalidation, optimistic updates |
| Client state | Zustand | Only when TanStack Query doesn't fit |
| Form handling | React Hook Form + Zod | Zod resolver for validation |
| HTTP server | Hono or Fastify | For management API endpoints |
| Testing | Vitest | Fast, native ESM |
| Database | SQLite via `better-sqlite3` | Embedded, zero-config, file-based |
| ORM | Drizzle ORM + `drizzle-kit` | Type-safe queries, auto-migrations |
| Logging | pino | Structured JSON |
| Package manager | pnpm | Single root package.json |
| Build (backend) | tsup | ESM output |
| Build (frontend) | Vite | Dev server + production build |
| Linting | ESLint flat config + typescript-eslint | Strict type-aware rules |
| Formatting | Prettier or Biome | Zero-debate formatting |

---

## Critical Rules

### MCP SDK Usage

```typescript
// CORRECT — use McpServer (high-level API)
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// WRONG — Server is deprecated
// import { Server } from "@modelcontextprotocol/sdk/server/index.js";
```

### TypeScript — Non-Negotiable

1. **`strict: true`** in every tsconfig. No `// @ts-ignore` without a linked issue.
2. **No `any`** — use `unknown` and narrow. If unavoidable, isolate in a typed wrapper with a comment explaining why.
3. **Named exports only** — no default exports.
4. **No enums** — use `as const` objects or discriminated unions.
5. **Validate at the boundary** — every external input passes through a Zod schema.
6. **Discriminated unions for state** — no boolean flags for multi-state logic.
7. **Exhaustive switch handling** — every `switch` on a union type has a `default: never` clause.
8. **One responsibility per file** — a tool, a service, a schema, a middleware. Not all four.
9. **No circular imports** — enforce with linting.
10. **Branded types for domain primitives** — `UserId`, `ToolName`, `ConnectionId`, etc.

### Error Handling

- **Expected failures** return `Result<T, E>` — never throw for business logic errors.
- **Domain errors are typed values** with a `_tag` discriminant, not plain `Error` subclasses.
- **`try/catch` only for truly unexpected errors** (I/O, network). Wrap them into `Result` at the boundary.
- Map domain errors to protocol errors (JSON-RPC codes) at the transport layer only.

### Dependency Injection

- Constructors and factory functions receive dependencies as parameters.
- No module-level singletons.
- Testable by default.

---

## Project Layout Rules

### Path Aliases

Use TypeScript path aliases instead of workspace packages:
- `@backend/*` → `src/backend/*`
- `@frontend/*` → `src/frontend/*`
- `@shared/*` → `src/shared/*`

### Shared Module

- All types/schemas shared between backend and frontend **must** live in `src/shared/`.
- Never duplicate a type across modules — import from shared.
- Shared module must have zero runtime dependencies beyond Zod.

### Import Rules

- Frontend **never** imports from backend.
- Backend **never** imports from frontend.
- Both import from shared.
- Within backend, dependencies flow inward: transport → router → handler → service. Business logic never imports from transport or framework layers.

### All Source in `src/`

- Every `.ts` / `.tsx` source file lives under `src/`.
- No source code at the project root.
- Single `package.json` at root — no `packages/` directory.

---

## Frontend Standards (React 19 + TanStack)

### Component Rules

- Function components only. No class components.
- Colocate component, hook, and test in the same directory.
- No barrel files (`index.ts` re-exports) — import directly from the source file.
- Props must be typed inline or with a named `type` (not `interface` for props).

### State Management

| State type | Solution |
|---|---|
| UI-local state | `useState` / `useReducer` |
| Server state (API data) | TanStack Query |
| Shared client state | Zustand |
| URL/route state | TanStack Router search params |
| Form state | React Hook Form + Zod |

### TanStack Query Patterns

- Define query keys as `const` arrays in a dedicated `queryKeys.ts` file.
- All API calls go through a typed API client — never call `fetch` directly in components.
- Use `queryOptions()` helper for type-safe query definitions.
- Mutations must invalidate relevant queries on success.

### Performance

- No premature `React.memo` — measure first.
- `useMemo`/`useCallback` only for referential stability (deps of other hooks, context values).
- Virtualize lists over 100 items.

### Accessibility

- Semantic HTML first, ARIA only when HTML falls short.
- All interactive elements must be keyboard accessible.
- Form inputs must have associated labels.

---

## Backend Standards (MCP Server)

### Tool Definitions

Each tool is a single file exporting a registration function:

```typescript
// tools/search.tool.ts
import { z } from "zod";

export const SearchInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().default(10),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

export function registerSearchTool(server: McpServer, deps: SearchDeps) {
  server.tool(
    "search",
    "Search for items",
    SearchInputSchema.shape,
    async (args) => {
      const result = await deps.searchService.search(args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
  );
}
```

### Database (SQLite + Drizzle)

- All application state persisted in embedded SQLite (`~/.simple-mcp/data.db`).
- Drizzle table definitions in `src/backend/db/schema.ts` are the single source of truth for DB structure.
- All DB access goes through typed repository functions in `src/backend/db/repositories/` — no raw SQL outside `db/`.
- Credentials column always encrypted (AES-256) — encrypt before write, decrypt on read.
- Migrations auto-run on server startup. Database file backed up before migrations.
- WAL mode enabled for concurrent read performance.
- Database file excluded from git.

### Config & Secrets

- All config loaded via Zod-validated env schemas — no raw `process.env` access.
- Secrets (API keys, tokens) encrypted in the database — never logged, serialized to responses, or committed to git.
- Connection configs (Jira, GitHub) managed via the frontend panel, persisted in SQLite.
- Use a dedicated `config/` directory for env schema validation.

### Middleware Pipeline

- Auth → Rate Limit → Logging → Handler → Error Handler.
- Each middleware is a separate file.
- Middleware never catches and swallows errors — it transforms or re-raises.

---

## Testing Standards

### Test Pyramid

- **Unit tests** (100+): Pure logic, schemas, type guards, utilities. Fast, isolated.
- **Integration tests** (20-40 per service): Handler + real dependencies.
- **E2E tests** (5-10): Full server over real transport.

### Test Rules

- Tests must not depend on execution order.
- Use `vi.fn()` for mocks — never mock module internals, mock at the boundary (service interfaces).
- Schema tests: validate both acceptance and rejection.
- Every bug fix must include a regression test.
- Test file naming: `*.test.ts` colocated with source or in `__tests__/`.

---

## Naming Conventions

| Entity | Convention | Example |
|---|---|---|
| Files | `kebab-case` | `search-tool.ts`, `use-connections.ts` |
| Tool files | `*.tool.ts` | `jira-search.tool.ts` |
| Service files | `*.service.ts` | `github.service.ts` |
| Schema files | `*.schema.ts` | `connection.schema.ts` |
| Middleware files | `*.middleware.ts` | `auth.middleware.ts` |
| Test files | `*.test.ts` | `search-tool.test.ts` |
| Types/interfaces | `PascalCase` | `ConnectionConfig`, `ToolResult` |
| Zod schemas | `PascalCase` + `Schema` suffix | `ConnectionConfigSchema` |
| Functions | `camelCase` | `registerTool`, `validateConfig` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT` |
| Branded types | `PascalCase` | `UserId`, `ConnectionId` |
| React components | `PascalCase` | `ConnectionPanel`, `ToolList` |
| React hooks | `use` prefix + `camelCase` | `useConnections`, `useToolExecution` |
| Query keys | `camelCase` array | `['connections', 'list']` |

---

## Git & Commit Standards

- **Semantic commits**: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Scope by package when relevant: `feat(backend):`, `fix(frontend):`, `refactor(shared):`
- One logical change per commit.
- Never commit `.env`, credentials, or secret values.
- Branch naming: `feat/description`, `fix/description`, `chore/description`

---

## Libraries to AVOID

| Library | Reason | Use Instead |
|---|---|---|
| `lodash` | Native methods suffice; tree-shaking unreliable | Native array/object methods |
| `moment` | Deprecated, large bundle | `date-fns` or `Temporal` |
| `express` | Outdated async handling, no TS-first | Hono or Fastify |
| `winston` | Over-engineered | pino |
| `class-validator` / `class-transformer` | Decorator-based, poor type inference | Zod |
| `axios` (for frontend) | Unnecessary with native fetch | `fetch` via typed API client |
| Heavy ORMs (TypeORM, Sequelize) | Runtime magic, poor type inference | Drizzle or Kysely |

---

## Security

- No secrets in code, logs, or error messages.
- Validate and sanitize all external input (API params, env vars, user input from frontend).
- Use parameterized queries for any database access — no string concatenation.
- CORS configured explicitly for the management panel origin only.
- Rate limiting on all public-facing endpoints.
- Auth tokens validated on every request — no trust based on transport layer alone.

---

## Documentation

- Do NOT create README.md or documentation files unless explicitly requested.
- Code should be self-documenting via types and naming.
- Comments only where logic is non-obvious — explain *why*, not *what*.
- Zod schemas serve as the documentation for data shapes.
