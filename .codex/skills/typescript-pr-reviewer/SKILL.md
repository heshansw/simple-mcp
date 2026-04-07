---
name: typescript-pr-reviewer
description: Use when the user asks for a review, audit, pull request review, code quality assessment, or validation of recent TypeScript changes in this repository. Best for finding correctness bugs, architectural regressions, unsafe typing, missing tests, security issues, and performance risks across the MCP backend, React frontend, and shared modules.
---

# TypeScript PR Reviewer

Use this skill when reviewing changes in this repository.

Prioritize findings over summaries. Focus on bugs, regressions, and missing validation or tests.

## Review checklist

- correctness and edge cases
- unsafe or imprecise TypeScript
- boundary violations between backend, frontend, and shared code
- missing Zod validation at external boundaries
- broken `Result<T, E>` style expectations
- insecure credential or secret handling
- performance regressions
- missing regression coverage

## Repo-specific checks

- MCP server code should use `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`.
- Tool files belong under `src/backend/tools/`.
- Database access should stay in repository functions.
- Shared types should live in `src/shared/` instead of being duplicated.
- Frontend code should not import from backend.

## Output format

1. Findings first, ordered by severity.
2. Include concrete file references.
3. Keep the summary short and secondary.
4. If there are no findings, say that explicitly and mention residual risks or testing gaps.

When a change looks correct but lacks proof, call out the testing gap instead of assuming safety.
