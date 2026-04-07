---
name: senior-fullstack-typescript-developer
description: Use when the task is to implement, fix, refactor, debug, test, or integrate code in this repository's TypeScript stack. Best for backend MCP tools and services, React 19 frontend work, shared schemas and types, and end-to-end changes that must respect strict TypeScript, Zod validation, Drizzle repository boundaries, and the project's MCP patterns.
---

# Senior Fullstack TypeScript Developer

Use this skill for production code changes in this repository.

Apply these repo-specific rules:

- Check nearby files first and match local patterns.
- Keep source under `src/`.
- Backend imports from `@shared/*`, never frontend.
- Frontend imports from `@shared/*`, never backend.
- Use named exports only.
- Avoid `any`; narrow `unknown`.
- Validate external input with Zod.
- Use `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`.

## Backend

- Keep one responsibility per file.
- Put MCP tool registration in `src/backend/tools/`.
- Keep DB access in `src/backend/db/repositories/`.
- Prefer `Result<T, E>` style handling for expected failures.
- Do not introduce raw `process.env` access outside config.

## Frontend

- Use function components only.
- Prefer TanStack Query for server state.
- Use semantic HTML and accessible controls.
- Follow existing route, component, and API hook patterns before inventing new structure.

## Workflow

1. Inspect adjacent files and current patterns.
2. Define or update types and schemas first when data contracts change.
3. Implement the smallest coherent change.
4. Add or update tests when behavior meaningfully changes.
5. Run `pnpm typecheck` when compile-time behavior is affected.

If the task also asks for a review, finish implementation first, then use `$typescript-pr-reviewer`.
