# Testing Patterns — this project

## InMemoryTransport MCP tool test setup

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

async function setupMcpToolTest(deps: MyToolDeps) {
  const server = new McpServer({ name: "test-server", version: "0.0.1" });
  registerMyTool(server, deps);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client };
}
```

## createMockDeps factory pattern

Always return a full deps object with `vi.fn()` defaults. Overrides
allow per-test customisation without re-defining the whole mock.

```typescript
function createMockDeps(overrides: Partial<MyDeps> = {}): MyDeps {
  return {
    myRepo: {
      findById: vi.fn().mockResolvedValue(someFixture),
      create: vi.fn().mockResolvedValue(someOtherFixture),
    },
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}
```

## Parsing tool response text

```typescript
function parseResponse(result: { content: unknown }) {
  const text =
    (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
  return JSON.parse(text);
}
```

## Overriding a single mock after createMockDeps

```typescript
vi.mocked(deps.myRepo.findById).mockResolvedValue(differentFixture);
```

Note: `vi.mocked()` is required when the function was typed via the
interface — it narrows the type so `.mockResolvedValue()` is available.

## beforeEach reset

```typescript
beforeEach(() => {
  deps = createMockDeps();
  vi.clearAllMocks();
});
```

Always call `vi.clearAllMocks()` in `beforeEach` to prevent call-count
bleed between tests. Re-creating `deps` resets the `vi.fn()` instances too.

## GitHub service mock

```typescript
import { ok, err, integrationError } from "@shared/result.js";

const githubService: Partial<GitHubService> = {
  reviewPullRequest: vi.fn().mockResolvedValue(
    ok({ id: 99001, state: "CHANGES_REQUESTED", html_url: "...", submitted_at: "..." })
  ),
};
// Cast to full type when passing as dep:
deps = { githubService: githubService as GitHubService, ... };
```

## ReviewsRepository mock (createCompleted)

The signature is `createCompleted(data: Omit<NewReview, "id" | "createdAt" | "startedAt" | "status">)`.
Mock with `.mockResolvedValue({ id: "rev-001" })` for minimal success fixture.
