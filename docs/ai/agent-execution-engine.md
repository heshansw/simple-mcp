# Agent Execution Engine

## Overview

The Agent Execution Engine transforms agent definitions (metadata-only objects describing required tools, system prompts, and integrations) into autonomous, self-correcting workflows. It enables agents to execute multi-step tasks by orchestrating Claude as the reasoning engine, with MCP tools as the action layer.

Before this engine, agents were passive definitions — Claude was the sole orchestrator, manually selecting tools and interpreting results. The engine adds a plan-execute-reflect loop that runs autonomously within configurable guardrails.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Agent Execution Engine                     │
│                                                                │
│  ┌──────────┐     ┌──────────────┐     ┌───────────────────┐ │
│  │  Task     │────▶│  Execution   │────▶│  Working Memory   │ │
│  │  Planner  │     │  Loop        │     │  Manager          │ │
│  └──────────┘     └──────┬───────┘     └───────────────────┘ │
│                          │                                     │
│              ┌───────────┼───────────┐                        │
│              ▼           ▼           ▼                        │
│  ┌──────────────┐ ┌──────────┐ ┌──────────────┐             │
│  │  Tool        │ │ Guardr-  │ │ Observation  │             │
│  │  Executor    │ │ ails     │ │ Summarizer   │             │
│  └──────┬───────┘ └──────────┘ └──────────────┘             │
│         │                                                     │
│         ▼                                                     │
│  ┌──────────────────┐     ┌──────────────────┐               │
│  │  Tool Handler    │     │  Delegation      │               │
│  │  Registry        │     │  Handler         │               │
│  └──────────────────┘     └──────────────────┘               │
│                                                                │
└────────────────────────────┬─────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │  Anthropic API  │
                    │  (Claude)       │
                    └─────────────────┘
```

### Data Flow

1. A goal is submitted via MCP tool (`agent_execute`) or HTTP endpoint (`POST /api/agents/execute`)
2. The **Task Planner** decomposes the goal into a DAG of sub-tasks via a Claude call
3. The **Execution Loop** iterates:
   - Checks **Guardrails** (iteration limits, token budget, cycle detection, timeout)
   - Sends current **Working Memory** to Claude via the Anthropic API
   - If Claude returns `tool_use` blocks: **Tool Executor** invokes them through the **Tool Handler Registry**
   - **Observation Summarizer** compresses large tool outputs before adding to memory
   - If Claude returns `end_turn`: the run completes with an answer
4. Results are persisted to SQLite via the agent runs/tasks repositories
5. If Claude calls `delegate_to_agent`: the **Delegation Handler** spawns a child execution

---

## Core Components

### Execution Engine — `src/backend/agents/engine/execution-engine.ts`

The central orchestrator. Factory function: `createExecutionEngine(deps)`.

**Interface:**
- `execute({ agentId, goal, config? })` — starts an agent run, returns `Result<AgentRunResult, DomainError>`
- `getRunStatus(runId)` — retrieves current status from the database
- `cancelRun(runId)` — cancels an active run

**Execution Loop (simplified):**
```
1. Validate agent exists and dependencies are met
2. Initialize working memory with system prompt + goal
3. Create DB run record (status: "planning")
4. Run optional task planning phase
5. LOOP:
   a. Check all guardrails → fail if violated
   b. Call anthropic.messages.create() with memory + tool schemas
   c. SWITCH on response stop_reason:
      - "tool_use": invoke tools → summarize observations → add to memory → continue
      - "end_turn": extract answer → mark completed → break
   d. On transient error: retry with exponential backoff (max 3 attempts)
6. Persist final state (result, token counts, timing)
7. Return AgentRunResult
```

**Key Design Decisions:**
- Uses Anthropic's native `tool_use` / `tool_result` message flow — no custom text parsing
- Tool schemas are converted from Zod to JSON Schema for the Anthropic API
- Reuses the `getAnthropicApiKey` dependency injection pattern from `ai-review.service.ts`

### Tool Handler Registry — `src/backend/agents/engine/tool-handler-registry.ts`

An in-process registry that stores `(name, zodSchema, handler)` triples for every MCP tool. When the execution engine needs to invoke a tool, it calls the handler directly — no JSON-RPC round-trip through the MCP transport.

**Interface:**
- `register(name, zodSchema, handler)` — registers a tool handler
- `get(name)` — returns the handler entry
- `list()` — returns all tool names
- `listEntries()` — returns all entries with schemas (for Anthropic tool definitions)
- `has(name)` — checks if a tool is registered

**Why in-process?** The MCP server's tools are registered with `server.tool()`, which handles JSON-RPC transport. For agent execution, going through transport would add latency and complexity. The registry provides a direct invocation path while sharing the same business logic.

### Tool Executor — `src/backend/agents/engine/tool-executor.ts`

Bridge between the execution engine and the tool handler registry. Wraps every tool invocation in `Result<ToolInvocation, DomainError>`, catches exceptions, logs invocations, and records timing.

**Interface:**
- `invoke(toolName, args)` — invokes a tool and returns a `Result`
- `listAvailable()` — lists all registered tool names
- `getEntries()` — returns all tool entries for building Anthropic tool definitions
- `getEntry(name)` — returns a specific tool's schema entry

### Working Memory Manager — `src/backend/agents/engine/working-memory.ts`

Manages the conversation history (Anthropic message array) within a configurable token budget.

**Features:**
- Token estimation using a ~4 characters/token heuristic (no external tokenizer dependency)
- Tracks system prompt, user messages, assistant messages, and tool results
- Auto-prunes when approaching 80% of the token budget by summarizing the oldest messages via a Claude call
- Provides `getMessages()` and `getSystemPrompt()` for the Anthropic API call

**Interface:**
- `init(systemPrompt, goal)` — initializes memory with system context
- `addUserMessage(content)` — adds a user message
- `addAssistantMessage(content)` — adds an assistant response
- `addToolResult(toolUseId, content)` — adds a tool result
- `getMessages()` — returns the current message array
- `getSystemPrompt()` — returns the system prompt
- `estimateTokens()` — returns estimated total token count
- `prune()` — summarizes old messages if over budget

### Observation Summarizer — `src/backend/agents/engine/observation-summarizer.ts`

Compresses large tool outputs (> 4000 characters) to prevent context window overflow.

**Three-tier strategy:**
1. **JSON field filtering** — if the output is valid JSON, selectively include important fields
2. **Claude summarization** — goal-aware summarization: "Summarize this output relevant to: {goal}"
3. **Truncation fallback** — hard truncate with "[...truncated]" suffix if all else fails

### Guardrails — `src/backend/agents/engine/guardrails.ts`

Safety checks that run before every iteration. Each check returns `Result<void, AgentExecutionError>`.

| Guardrail | Default | Purpose |
|---|---|---|
| Max iterations | 25 | Prevents infinite planning/execution loops |
| Max tool calls | 100 | Caps total tool invocations |
| Max tokens | 200,000 | Budget for total token consumption |
| Timeout | 5 minutes | Wall-clock time limit |
| Cycle detection | 3 identical | Detects repeated identical tool calls |

**Interface:**
- `checkAll()` — runs all guardrail checks, returns first failure or `Ok(undefined)`
- `recordIteration()` — increments iteration counter
- `recordToolCall(name, args)` — records a tool call for cycle detection
- `recordTokens(count)` — adds to the token accumulator

### Task Planner — `src/backend/agents/engine/task-planner.ts`

Decomposes a goal into an ordered set of sub-tasks (DAG) via a dedicated Claude call.

**Interface:**
- `plan(goal, availableTools)` — returns `Result<TaskPlan, DomainError>`
- `replan(goal, completedTasks, failedTask, availableTools)` — replans with context of what succeeded/failed

**Task shape:**
```typescript
type PlannedTask = {
  id: string;
  description: string;
  dependsOn: string[];
  requiredTools: string[];
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
};
```

Planning is advisory — the execution engine may deviate if Claude determines a different approach during execution.

### Delegation Handler — `src/backend/agents/engine/delegation.ts`

Enables inter-agent delegation. A meta-tool `delegate_to_agent` is injected into every agent's tool set. When Claude calls this tool, the delegation handler:

1. Validates the target agent exists and has its dependencies met
2. Summarizes the parent context to 2000 characters max
3. Creates a child execution with the summarized context as the goal
4. Returns the child's result to the parent agent

**Constraints:**
- Maximum delegation depth: 2 (prevents runaway cascading)
- Uses `setExecuteFn()` pattern to break circular dependency between engine and handler

---

## State Machine

Agent runs follow a discriminated union state machine:

```
┌──────┐
│ Idle │
└──┬───┘
   │
   ▼
┌──────────┐     ┌───────────┐     ┌────────────┐
│ Planning │────▶│ Executing │────▶│ Reflecting │──┐
└──────────┘     └─────┬─────┘     └────────────┘  │
                       │                  ▲         │
                       │                  └─────────┘
                       │
                  ┌────┴────┐
                  ▼         ▼
           ┌────────────┐ ┌──────────┐
           │ Delegating │ │ Awaiting │
           │            │ │ ToolRes. │
           └────────────┘ └──────────┘
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
        ┌───────────┐ ┌──────┐ ┌───────────┐
        │ Completed │ │Failed│ │ Cancelled │
        └───────────┘ └──────┘ └───────────┘
```

**States stored in DB:** `planning`, `executing`, `completed`, `failed`, `cancelled`

**Runtime-only states (not persisted):** `Idle`, `AwaitingToolResult`, `Reflecting`, `Delegating`

---

## Database Schema

### `agent_runs` Table

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID, branded as `AgentRunId` |
| `agentId` | TEXT | Reference to agent definition |
| `goal` | TEXT | The task the agent was asked to accomplish |
| `status` | TEXT | planning, executing, completed, failed, cancelled |
| `result` | TEXT (JSON) | Serialized `AgentRunResult` on completion |
| `config` | TEXT (JSON) | Serialized `AgentRunConfig` overrides |
| `iterationCount` | INTEGER | Number of plan-execute-reflect cycles |
| `toolCallCount` | INTEGER | Total tool invocations |
| `inputTokensUsed` | INTEGER | Anthropic API input tokens consumed |
| `outputTokensUsed` | INTEGER | Anthropic API output tokens consumed |
| `parentRunId` | TEXT | Parent run ID for delegated executions |
| `errorMessage` | TEXT | Error description if status is "failed" |
| `startedAt` | TEXT | ISO 8601 timestamp |
| `completedAt` | TEXT | ISO 8601 timestamp |
| `createdAt` | TEXT | ISO 8601 timestamp |

### `agent_tasks` Table

| Column | Type | Description |
|---|---|---|
| `id` | TEXT PK | UUID, branded as `AgentTaskId` |
| `runId` | TEXT FK | References `agent_runs.id` |
| `description` | TEXT | Task description from planner |
| `dependsOn` | TEXT (JSON) | Array of task IDs this depends on |
| `requiredTools` | TEXT (JSON) | Array of tool names needed |
| `status` | TEXT | pending, in_progress, completed, failed, skipped |
| `result` | TEXT (JSON) | Task result data |
| `startedAt` | TEXT | ISO 8601 timestamp |
| `completedAt` | TEXT | ISO 8601 timestamp |
| `createdAt` | TEXT | ISO 8601 timestamp |

---

## MCP Tools

### `agent_execute`

Starts an autonomous agent execution.

**Input:**
```json
{
  "agentId": "database-explorer",
  "goal": "Analyze the users table schema and suggest optimizations",
  "maxIterations": 10,
  "maxToolCalls": 50,
  "maxTokens": 100000
}
```

**Output:** `AgentRunResult` with `runId`, `answer`, `tasksCompleted`, `toolCallsMade`, `iterationsUsed`, `inputTokensUsed`, `outputTokensUsed`, `durationMs`.

### `agent_status`

Retrieves the current status of an agent run.

**Input:** `{ "runId": "abc-123" }`

**Output:** `AgentRunStatus` with `runId`, `agentId`, `goal`, `state`, iteration counts, token usage, timing, error message, and result.

### `agent_list`

Lists all registered agents with their dependency status.

**Input:** None

**Output:** Array of agents with `id`, `name`, `description`, `status` (ready / missing_dependencies / disabled), and `missingDependencies` list.

---

## HTTP API

### POST `/api/agents/execute`

Start an agent execution (blocks until completion).

**Request:**
```json
{
  "agentId": "string",
  "goal": "string",
  "config": {
    "maxIterations": 25,
    "maxToolCalls": 100,
    "maxTokens": 200000
  }
}
```

**Response (200):** `AgentRunResult`

**Response (400):** `{ "error": "agentId and goal are required" }`

**Response (500):** `{ "error": "Agent execution error message" }`

### GET `/api/agents/runs?limit=50`

List recent agent runs.

**Response (200):** Array of raw DB row objects.

### GET `/api/agents/runs/:id`

Get a specific run's current status.

**Response (200):** `AgentRunStatus` (note: uses `state` field, not `status`)

**Response (404):** `{ "error": "Run not found" }`

### POST `/api/agents/runs/:id/cancel`

Cancel an active run.

**Response (200):** `{ "success": true }`

**Response (404):** `{ "error": "Run not found" }`

---

## Configuration

### Default Run Configuration

| Parameter | Default | Description |
|---|---|---|
| `maxIterations` | 25 | Maximum plan-execute-reflect cycles |
| `maxToolCalls` | 100 | Maximum total tool invocations |
| `maxTokens` | 200,000 | Maximum total tokens (input + output) |
| `timeoutMs` | 300,000 (5 min) | Wall-clock time limit |
| `enablePlanning` | true | Whether to run the task planning phase |
| `enableDelegation` | true | Whether agents can delegate to other agents |
| `maxDelegationDepth` | 2 | Maximum nesting level for delegated runs |

All defaults can be overridden per-execution via the `config` parameter.

### Anthropic API Key Resolution

The engine resolves the Anthropic API key in this order:
1. `ANTHROPIC_API_KEY` environment variable
2. Database connections table (type "anthropic")

This follows the same DI pattern used by `ai-review.service.ts`.

---

## Error Handling

### AgentExecutionError

A domain error variant added to the `DomainError` discriminated union:

```typescript
type AgentExecutionError = {
  readonly _tag: "AgentExecutionError";
  readonly agentId: string;
  readonly runId: string;
  readonly message: string;
  readonly phase: "planning" | "execution" | "reflection" | "delegation";
};
```

This integrates with:
- The `Result<T, E>` pattern (never throws for business logic)
- The error handler middleware (maps to HTTP 500, code `AGENT_EXECUTION_ERROR`)
- The `domainErrorMessage()` helper for human-readable error text
- All exhaustive switches on `DomainError` (error handler, etc.)

### Retry Logic

Transient errors (API failures, rate limits) trigger exponential backoff retry:
- Max retries: 3
- Backoff: 1s, 2s, 4s
- After max retries, the run fails with the last error

### Cycle Detection

If the engine detects 3 or more identical consecutive tool calls (same name + same arguments), it terminates the run. This prevents infinite loops where Claude repeatedly calls the same tool expecting different results.

---

## Frontend UI

### Executions List Page (`/agent-executions`)

- Displays a table of all recent agent runs with status, agent name, goal, metrics, and timing
- "Execute Agent" button reveals an inline form to start a new execution
- Each row links to the detail page
- Status shown via color-coded badges (blue=planning, amber=executing, green=completed, red=failed, gray=cancelled)

### Execution Detail Page (`/agent-executions/:runId`)

- Full run details: goal, status, metrics (iterations, tool calls, tokens), timing
- Result section with parsed answer (if completed)
- Error section with error message (if failed)
- Cancel button for active runs
- Auto-refreshes every 3 seconds for active runs (planning/executing states)
- Pulsing indicator shows when auto-refresh is active

### Execute Agent Form

- Agent selector dropdown (populated from agent registry)
- Goal textarea
- Advanced options toggle (max iterations, max tool calls, max tokens)
- Disabled state while execution is in progress
- Error display on failure

---

## Security Considerations

1. **API Key Handling** — Anthropic API keys are resolved at runtime from env vars or encrypted DB storage. Never logged, serialized in responses, or exposed to the frontend.

2. **Guardrails** — All executions are bounded by iteration, tool call, token, and time limits. No unbounded execution is possible.

3. **Delegation Depth** — Maximum depth of 2 prevents cascading agent spawns that could consume unbounded resources.

4. **Input Validation** — All inputs validated via Zod schemas at the API boundary. Agent IDs verified against the registry before execution.

5. **Tool Invocation Isolation** — Tools run in-process but each invocation is wrapped in try/catch with `Result<T, E>` error handling. Failures in one tool don't crash the engine.

6. **No Secret Exposure** — Error messages sanitized before returning to clients. Tool outputs that might contain credentials are handled by the observation summarizer.

---

## File Map

```
src/
├── backend/
│   ├── agents/
│   │   └── engine/
│   │       ├── types.ts                  # State machine, config types
│   │       ├── execution-engine.ts       # Core execution loop
│   │       ├── tool-handler-registry.ts  # In-process tool registry
│   │       ├── tool-executor.ts          # Tool invocation bridge
│   │       ├── working-memory.ts         # Token-managed message history
│   │       ├── observation-summarizer.ts # Output compression
│   │       ├── guardrails.ts            # Safety limits
│   │       ├── task-planner.ts          # Goal decomposition
│   │       ├── delegation.ts            # Inter-agent delegation
│   │       └── index.ts                 # Re-exports
│   ├── db/
│   │   ├── schema.ts                    # agent_runs + agent_tasks tables
│   │   └── repositories/
│   │       ├── agent-runs.repository.ts
│   │       └── agent-tasks.repository.ts
│   └── tools/system/
│       ├── agent-execute.tool.ts
│       ├── agent-status.tool.ts
│       └── agent-list.tool.ts
├── frontend/
│   ├── api/
│   │   ├── agent-executions.api.ts      # Query + mutation hooks
│   │   └── query-keys.ts               # agentExecutionKeys
│   ├── components/
│   │   ├── run-status-badge.tsx         # Status badge
│   │   └── execute-agent-form.tsx       # Execute form
│   └── routes/agent-executions/
│       ├── index.tsx                    # List page
│       └── $runId.tsx                   # Detail page
└── shared/
    ├── result.ts                        # AgentExecutionError variant
    ├── types.ts                         # AgentRunId, AgentTaskId branded types
    └── schemas/
        └── agent-execution.schema.ts    # Zod schemas
```
