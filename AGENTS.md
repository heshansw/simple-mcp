# AGENTS.md

## Purpose

This repository implements a local MCP server plus admin panel for managing integrations, tools, and autonomous agents.

Codex should treat this as a TypeScript full-stack project with:

- `src/backend/`: MCP server, HTTP API, agent engine, services, repositories
- `src/frontend/`: React 19 admin panel
- `src/shared/`: shared schemas, types, and utilities

## Architecture Rules

- Use `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`.
- Keep all source under `src/`.
- Backend may import from `@shared/*`, never from frontend.
- Frontend may import from `@shared/*`, never from backend.
- Prefer Zod schemas at boundaries and `Result<T, E>` style error handling for expected failures.
- Use named exports only.
- Avoid `any`; use `unknown` and narrow.

## Editing Rules

- Prefer minimal, local changes that preserve existing architecture.
- Do not delete or rewrite `.claude/` files unless the task explicitly requires changing Claude-specific behavior.
- When adding Codex support, prefer shared or neutral wording over tool or code paths branded for a single client.
- Preserve the current MCP tool surface unless a change is needed for compatibility or correctness.

## Verification

- Use `pnpm typecheck` for TypeScript validation when code changes affect compile-time behavior.
- Use targeted reads with `rg` and `sed`; avoid broad refactors without confirming call sites.

## Codex Workflow In This Repo

When Codex is connected to this MCP server, prefer the tracked run workflow for agentic tasks:

1. Call `agent_list` to discover available agents and readiness.
2. Call `agent_start_run` to begin a tracked run and receive the agent prompt and task list.
3. Execute the required MCP tools.
4. Record material progress with `agent_record_step`.
5. Update planned tasks with `agent_update_task` when task tracking is in use.
6. Finalize with `agent_complete_run`.

Use `agent_execute` only when you intentionally want the server's built-in Anthropic execution engine to run the loop itself.

## Codex Roles

This repo includes two Codex-oriented role assets under `.codex/`:

- `senior-fullstack-typescript-developer`: implementation, debugging, refactoring, integration, and testing across backend, frontend, and shared modules
- `typescript-pr-reviewer`: review, audit, regression spotting, architectural scrutiny, and test-gap identification

Use the matching skill when the user intent is clear. If the task spans both, implement first and review second.

Paths:

- `.codex/skills/senior-fullstack-typescript-developer/SKILL.md`
- `.codex/skills/typescript-pr-reviewer/SKILL.md`
- `.codex/agents/senior-fullstack-typescript-developer.md`
- `.codex/agents/typescript-pr-reviewer.md`

## Claude Artifacts

The existing `.claude/` directory is useful reference material for project conventions, agent personas, and Claude-specific automation. Mirror useful project guidance into Codex-compatible files, but do not assume Claude hooks or settings apply to Codex.
