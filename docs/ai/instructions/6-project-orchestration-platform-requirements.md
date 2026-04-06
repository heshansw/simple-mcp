# 6 — Project Orchestration Platform Requirements

> **Status:** Planned
> **Created:** 2026-04-06
> **Updated:** 2026-04-06
> **Depends On:** Agent Execution Engine (see `docs/ai/agent-execution-engine.md`)

---

## 1. Overview

Extend the existing Agent Execution Engine into a **full project orchestration platform** where orchestrator agents decompose complex goals (build a feature, fix a bug, review a PR) into phases, delegate to specialist agents, and track every step — with all progress visible in a rich admin panel dashboard.

### Goals

- Enable end-to-end project/task execution: goal in → completed work + PR + Jira updates out
- Provide full visibility into agent execution via step-by-step tracking and progress dashboards
- Support frontend-only, backend-only, and fullstack orchestration workflows
- Automate project tooling: PR creation, Jira issue management, code scanning

---

## 2. Requirements

### REQ-6.1: Specialist Agents

A library of domain-specific agents that perform focused development tasks:

| Agent | ID | Focus | Required Integrations |
|---|---|---|---|
| React Frontend Developer | `react-frontend-dev` | React/TS component creation, hooks, state management, routing, styling, accessibility | `local-filesystem`, `github` |
| Java Backend Developer | `java-backend-dev` | Java/Spring REST APIs, services, JPA/Hibernate, Maven/Gradle, design patterns | `local-filesystem`, `github` |
| Database Architect | `database-architect` | Schema design, migrations, indexing, query optimization, normalization | `local-filesystem` |
| QA Engineer | `qa-engineer` | Test strategy, unit/integration/e2e tests, coverage analysis, regression tests | `local-filesystem` |
| Business Analyst | `business-analyst` | Requirements elicitation, user stories, acceptance criteria, spec documents | `jira` |
| Backend PR Reviewer | `backend-pr-reviewer` | Backend code review: API design, error handling, security, performance | `github` |
| Frontend PR Reviewer | `frontend-pr-reviewer` | Frontend code review: component design, accessibility, UX, hooks patterns | `github` |
| Security Reviewer | `security-reviewer` | Security audit: OWASP Top 10, auth flows, input validation, secrets, dependencies | `github` |

**Acceptance Criteria:**
- Each agent is a single `*.agent.ts` file following the existing `AgentDefinition` pattern
- Each agent has a detailed system prompt with domain-specific expertise and examples
- Agents are registered in the agent registry and visible in the admin panel
- Agents can be executed independently or delegated to by orchestrators

### REQ-6.2: Orchestrator Agents

High-level agents that decompose goals and delegate to specialist agents:

| Orchestrator | ID | Delegates To |
|---|---|---|
| Frontend Orchestrator | `frontend-orchestrator` | `react-frontend-dev`, `frontend-pr-reviewer`, `qa-engineer`, `security-reviewer`, `business-analyst` |
| Backend Orchestrator | `backend-orchestrator` | `java-backend-dev`, `backend-pr-reviewer`, `database-architect`, `qa-engineer`, `security-reviewer`, `business-analyst` |
| Fullstack Orchestrator | `fullstack-orchestrator` | All specialist agents |

**Workflow:**
1. **SCAN** — Use filesystem tools to understand project structure, tech stack, and conventions
2. **PLAN** — Decompose the goal into ordered phases with dependencies
3. **DELEGATE** — Assign each phase to the best specialist agent via `delegate_to_agent`
4. **AUTOMATE** — Create/update Jira issues to track progress, create PRs when code is ready
5. **REPORT** — Produce a summary of all work completed

**Acceptance Criteria:**
- Orchestrators never write code directly — they always delegate to specialists
- Orchestrator system prompts include the full specialist agent catalog (IDs, capabilities)
- Orchestrators scan the target project before planning (system prompt instructs scan-first)
- Delegation depth increased from 2 to 3 (orchestrator → specialist → sub-task)
- Each orchestrator can create Jira issues and GitHub PRs as part of the workflow

### REQ-6.3: Missing Tool Registration

Several existing MCP tools are not available to the execution engine because they are not registered in the `ToolHandlerRegistry`:

| Tool | Service Method | Status |
|---|---|---|
| `github_create_pr` | `githubService.createPullRequest()` | **Service method does not exist** — must be created |
| `github_submit_review` | `githubService.reviewPullRequest()` | Service exists, **not in ToolHandlerRegistry** |
| `jira_add_comment` | `jiraService.addComment()` | Service exists, **not in ToolHandlerRegistry** |
| `jira_get_comments` | `jiraService.getIssueComments()` | Service exists, **not in ToolHandlerRegistry** |

**Acceptance Criteria:**
- `createPullRequest` method added to `GitHubService` (uses `POST /repos/{owner}/{repo}/pulls`)
- `github_create_pr` registered as both an MCP tool and in the ToolHandlerRegistry
- All 3 existing tools added to the ToolHandlerRegistry so the execution engine can invoke them
- All tools return `Result<T, E>` — no thrown exceptions

### REQ-6.4: Step-by-Step Execution Tracking

Track every action taken during an agent run as a discrete "step" for full observability:

**Step Types:**
- `llm_call` — Each Anthropic API call (reasoning, tokens used, duration)
- `tool_call` — Each tool invocation (name, arguments, result, duration, success/error)
- `delegation` — Each delegation to a sub-agent (target agent ID, child run ID)
- `plan` — Task plan creation (task descriptions)
- `error` — Errors encountered during execution
- `guardrail` — Guardrail limit hits (which limit, current value vs max)

**Data Model — `agent_run_steps` table:**

| Column | Type | Description |
|---|---|---|
| `id` | text PK | Branded `AgentRunStepId` |
| `runId` | text FK | References `agent_runs.id` |
| `stepIndex` | integer | Sequential step number within the run |
| `stepType` | text | One of the step types above |
| `toolName` | text (nullable) | Tool name for `tool_call` steps |
| `toolArgs` | text (nullable) | JSON-serialized tool arguments |
| `toolResult` | text (nullable) | Truncated tool result |
| `toolIsError` | integer (nullable) | 1 if tool returned an error |
| `delegateTargetAgentId` | text (nullable) | Target agent for `delegation` steps |
| `delegateChildRunId` | text (nullable) | Child run ID for `delegation` steps |
| `reasoning` | text (nullable) | Claude's reasoning/thinking for `llm_call` steps |
| `inputTokens` | integer | Input tokens for this step |
| `outputTokens` | integer | Output tokens for this step |
| `durationMs` | integer | Wall-clock duration in milliseconds |
| `createdAt` | text | ISO 8601 timestamp |

**Acceptance Criteria:**
- Every action in the execution engine emits a step record to the `agent_run_steps` table
- Step writes are fire-and-forget (wrapped in try/catch) — never block the execution loop
- Steps are queryable by `runId` with pagination support
- Tool arguments and results are truncated to prevent excessive storage
- Step index increments sequentially within each run

### REQ-6.5: Project/Task Progress Dashboard

The admin panel dashboard (`/` route) must be enhanced with a **Project/Task Progress** section that provides at-a-glance visibility into all agent execution activity.

#### 6.5.1 Dashboard Home — Progress Overview

Enhance the existing dashboard page (`src/frontend/routes/index.tsx`) with:

**a) Execution Stats Bar (top of page, below Server Health)**
- Total Runs (all time)
- Active Runs (currently executing/planning)
- Success Rate (% completed successfully)
- Total Tokens Used (input + output, all runs)
- Average Duration (across completed runs)

**b) Active Executions Panel**
- Live list of currently running agent executions (status = `planning` or `executing`)
- Each row shows: agent name, goal (truncated), current state, iterations so far, elapsed time, progress bar (iterations used / max iterations)
- Auto-refreshes every 3 seconds
- Click navigates to execution detail page
- "No active executions" empty state when idle

**c) Recent Completions Feed**
- Last 10 completed/failed/cancelled runs
- Each row shows: status badge, agent name, goal (truncated), duration, token count, timestamp
- Color-coded: green for completed, red for failed, gray for cancelled
- Click navigates to execution detail page

**d) Agent Performance Summary**
- Table/grid showing per-agent aggregated stats:
  - Agent name
  - Total runs
  - Success rate (%)
  - Avg duration
  - Avg tokens per run
  - Last run timestamp
- Sortable by any column
- Only shows agents that have been executed at least once

#### 6.5.2 Execution Detail — Step Tracking Tabs

Enhance the execution detail page (`/agent-executions/:runId`) with tabbed views below existing metrics:

**a) Steps Tab (default)**
- Vertical timeline of all steps in chronological order
- Each step shows: icon (per step type), step type label, timestamp, duration
- `llm_call` steps: expandable reasoning text, token counts
- `tool_call` steps: tool name, collapsible args JSON, result preview, error badge if failed
- `delegation` steps: target agent name, link to child run detail page
- `plan` steps: list of planned tasks
- `guardrail` steps: which limit was hit, current vs max values
- Auto-refreshes for active runs

**b) Tool Calls Tab**
- Filtered table showing only tool call steps
- Columns: #, Tool Name, Arguments (collapsible), Result (truncated), Duration, Error
- Sortable by duration to identify slow tool calls

**c) Delegation Tab** (only shown when run has parent or children)
- Tree visualization showing parent → child agent run hierarchy
- Each node shows: agent name, status badge, goal (truncated), duration
- Click any node to navigate to that run's detail page
- Shows delegation depth level indicators

**d) Token Usage Tab**
- Inline SVG bar chart showing cumulative token usage per step
- Separate bars for input and output tokens
- Running total line
- No external chart library — pure inline SVG

#### 6.5.3 Executions List — Stats Overview

Enhance the executions list page (`/agent-executions`) with:

- Execution stats card at the top (same data as dashboard stats bar but in a card layout)
- Filter by agent, status, date range
- Pagination for large run histories

#### 6.5.4 Backend API Endpoints

New endpoints required:

| Method | Path | Response | Description |
|---|---|---|---|
| `GET` | `/api/agent-runs/:id/steps` | `{ steps: AgentRunStep[], total: number }` | Paginated steps for a run (query: `offset`, `limit`) |
| `GET` | `/api/agent-runs/:id/delegation-tree` | `{ run: RunSummary, children: DelegationNode[] }` | Recursive delegation hierarchy |
| `GET` | `/api/agent-runs/stats` | `{ totalRuns, activeRuns, successRate, avgDurationMs, totalTokens, agentUsage[] }` | Aggregate stats for dashboard |

**Acceptance Criteria:**
- Dashboard loads execution stats on page load with TanStack Query
- Active executions panel auto-polls every 3 seconds
- All new components use inline styles (no CSS framework)
- Step timeline auto-scrolls to latest step for active runs
- Delegation tree renders recursively for nested delegations
- Token usage chart renders as pure inline SVG (no chart library dependency)
- All data fetched via typed API client with proper query key invalidation
- Loading and error states handled with existing `LoadingSpinner` and `ErrorDisplay` components
- Empty states shown when no data exists

---

## 3. Architecture Constraints

- **No new runtime dependencies** — use existing stack (React 19, TanStack, Hono, SQLite, Drizzle)
- **Inline styles only** — no CSS modules, Tailwind, or external CSS
- **Named exports only** — no default exports
- **Result<T, E> error handling** — no thrown exceptions for business logic
- **Branded types** — new IDs use branded type pattern (`AgentRunStepId`)
- **Fire-and-forget step writes** — never block the execution engine loop
- **Delegation depth 3** — orchestrator(0) → specialist(1) → sub-task(2)
- **No EventEmitter for step streaming** — SQLite inserts + frontend polling via TanStack Query refetchInterval

---

## 4. File Impact Summary

### New Files (19)

| # | Area | File | Purpose |
|---|---|---|---|
| 1 | DB | `src/backend/db/repositories/agent-run-steps.repository.ts` | Step CRUD + pagination |
| 2 | Tool | `src/backend/tools/github/create-pr.tool.ts` | MCP tool for GitHub PR creation |
| 3-10 | Agents | `src/backend/agents/{specialist}.agent.ts` (x8) | 8 specialist agent definitions |
| 11-13 | Agents | `src/backend/agents/{orchestrator}.agent.ts` (x3) | 3 orchestrator agent definitions |
| 14-18 | Frontend | `src/frontend/components/{component}.tsx` (x5) | Step timeline, tool call log, delegation tree, token chart, execution stats card |

### Modified Files (12)

| # | File | Change |
|---|---|---|
| 1 | `src/backend/db/schema.ts` | Add `agentRunStepsTable` |
| 2 | `src/backend/db/client.ts` | Add CREATE TABLE for `agent_run_steps` |
| 3 | `src/shared/types.ts` | Add `AgentRunStepId` branded type |
| 4 | `src/backend/agents/engine/types.ts` | Add `StepType`, increase maxDelegationDepth to 3 |
| 5 | `src/backend/agents/engine/execution-engine.ts` | Emit step records on every action |
| 6 | `src/backend/services/github.service.ts` | Add `createPullRequest` method |
| 7 | `src/backend/server.ts` | New tools, agents, endpoints, repo wiring |
| 8 | `src/backend/agents/index.ts` | Export 11 new agents |
| 9 | `src/frontend/api/agent-executions.api.ts` | Add step/delegation/stats types + hooks |
| 10 | `src/frontend/api/query-keys.ts` | Add steps, delegationTree, stats keys |
| 11 | `src/frontend/routes/agent-executions/$runId.tsx` | Add tabbed step view |
| 12 | `src/frontend/routes/index.tsx` | Add project/task progress section to dashboard |
| 13 | `src/frontend/routes/agent-executions/index.tsx` | Add stats card at top |

---

## 5. Out of Scope

- Real-time WebSocket streaming of steps (polling is sufficient for MVP)
- External chart libraries (all visualization via inline SVG)
- Agent marketplace or user-created agent definitions
- Multi-user / multi-tenant support
- CI/CD pipeline integration (beyond PR creation)
