# QA Agent Memory

See detailed notes in topic files linked below.

## Key patterns confirmed in this project

- MCP tool tests use `McpServer` + `InMemoryTransport` + `Client` — see `patterns.md`
- Mock at the repository interface boundary, never at the DB level for tool tests
- `vi.mocked()` wrapping is required before calling `.mockResolvedValue()` on a function
  that was set up as `vi.fn()` in `createMockDeps`
- `result.isError` is `true` for both Zod validation failures and business-logic errors
  — both paths correctly set `isError: true` in the MCP response
- Schema tests: use `.safeParse()` and check `.success`, never `.parse()` (which throws)
- `it.each` works well for testing every enum member of Zod enum schemas

## File locations

- Test pattern reference: `src/backend/tools/jira/add-comment.tool.test.ts`
- Shared result helpers: `src/shared/result.ts` (ok, err, integrationError, etc.)
- Repository interfaces are in the same file as the implementation (e.g. `*.repository.ts`)

## Links to topic files

- `patterns.md` — InMemoryTransport test setup pattern, mock dep factory pattern
