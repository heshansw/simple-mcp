# Simple MCP

A local [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server with a React admin panel for managing integrations (Jira, GitHub), AI-powered agents, and server configuration.

Built with TypeScript, the MCP SDK, Hono, React 19, TanStack Router/Query, SQLite (Drizzle ORM), and Zod.

---

## Features

### MCP Tools

| Tool | Description |
|---|---|
| `jira_search_issues` | Search Jira issues with JQL |
| `jira_create_issue` | Create a new Jira issue |
| `jira_transition_issue` | Transition a Jira issue to a different status |
| `github_list_prs` | List pull requests for a repository |
| `github_get_my_prs` | Get PRs assigned to, requested from, or created by you |
| `github_review_pr` | AI-powered pull request review with inline comments |
| `github_get_pr_diff` | Get the diff for a pull request |
| `github_search_code` | Search code across GitHub repositories |
| `agent_execute` | Start an autonomous agent execution with a goal |
| `agent_status` | Check the progress or result of an agent run |
| `agent_list` | List all agents with dependency readiness status |
| `health_check` | Check server health and connection statuses |
| `list_connections` | List all configured integrations |

### Admin Panel

A React 19 web UI for managing the MCP server:

- **Connections** — Add, edit, test, and remove Jira/GitHub integrations
- **My PRs** — Dashboard showing PRs assigned to you, review requests, and PRs you created
- **Reviews** — History and stats for AI-powered PR reviews
- **Agents** — Configure pre-built agents (Jira Triage, PR Review, Code Search, Sprint Planning)
- **Settings** — Server configuration

### Screenshots
#### Connections
<img width="1725" height="956" alt="connections" src="https://github.com/user-attachments/assets/9cdcd3b0-4e5f-47ee-9008-bae0f10b7eb3" />

#### My PRs
<img width="1725" height="956" alt="my-prs" src="https://github.com/user-attachments/assets/4befe419-1180-4843-9aea-c4a7e8c22be6" />

#### Review Insights
<img width="1725" height="956" alt="review-insights" src="https://github.com/user-attachments/assets/a9a4c3cc-d787-4aa3-94ba-75b27eefae65" />

#### Main Dashboard
<img width="1725" height="956" alt="main-dashboard" src="https://github.com/user-attachments/assets/619533d7-29e0-431a-95cc-6d9cfebebc09" />

#### Local Repository Management 
<img width="1800" height="1542" alt="screencapture-localhost-3100-local-repos-2026-04-02-17_15_33" src="https://github.com/user-attachments/assets/291b1027-4b32-4eea-970a-6b8959c035fe" />

#### Local Database Connection and token consumption log
<img width="1800" height="1158" alt="screencapture-localhost-3100-databases-2026-04-02-17_17_05" src="https://github.com/user-attachments/assets/05f29e28-12d4-408f-b910-fbc1897cd581" />

<img width="1800" height="1532" alt="screencapture-localhost-3100-databases-2026-04-02-17_18_03" src="https://github.com/user-attachments/assets/2d8b1952-dbc5-40fb-a877-a6b3b36b833d" />

## Agentic Ochestration
Users of simple-mcp tool can track and detect agentic ochestration on task management

<img width="1716" height="955" alt="Screenshot 2026-04-07 at 11 51 20" src="https://github.com/user-attachments/assets/b98b49dc-bf1a-40d5-885f-f37c48f24725" />

<img width="1716" height="955" alt="Screenshot 2026-04-07 at 11 51 28" src="https://github.com/user-attachments/assets/98035114-5c8f-4533-a5d6-0e01c3b2ea81" />


### Pre-built Agents

| Agent | ID | Required Integration | Description |
|---|---|---|---|
| Jira Triage | `jira-triage` | Jira | Automated issue triage and classification |
| PR Review | `pr-review` | GitHub | AI-powered code review with inline GitHub comments |
| Code Search | `code-search` | GitHub | Semantic code search across repositories |
| Sprint Planning | `sprint-planning` | Jira | Sprint planning assistance |
| Local Repo Analysis | `local-repo-analysis` | Local Filesystem | Analyse local repository structure and code |
| Confluence Reader | `confluence-reader` | Jira | Read and search Confluence pages and spaces |
| Database Explorer | `database-explorer` | MySQL / PostgreSQL | Explore database schemas, run queries, suggest optimisations |

### Agent Execution Engine

Agents can run **autonomously** — give them a goal and they plan, execute tools, reflect on results, and self-correct until the goal is achieved. The built-in execution engine uses Anthropic for server-side reasoning, and the same MCP tool layer can also be driven directly by external clients such as Claude Code or Codex.

| MCP Tool | Description |
|---|---|
| `agent_execute` | Start an autonomous agent run with a goal and optional config |
| `agent_status` | Check the progress / result of a running or completed agent |
| `agent_list` | List all agents with their dependency readiness status |

See [Agent Execution Engine — Full Guide](#agent-execution-engine--full-guide) below for detailed usage instructions.

---

## Prerequisites

- **Node.js** 20+
- **pnpm** 9+ (package manager)

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/heshansw/simple-mcp
cd claude_mcp
pnpm install
```

### 2. Configure environment

Create a `.env` file in the project root:

```bash
# Required for AI-powered PR reviews (optional otherwise)
ANTHROPIC_API_KEY=sk-ant-...

# Optional — defaults shown
CLAUDE_MCP_DB_PATH=~/.simple-mcp/data.db
CLAUDE_MCP_ADMIN_PORT=3101
CLAUDE_MCP_LOG_LEVEL=info
CLAUDE_MCP_TRANSPORT=stdio

# Recommended — set a strong key for credential encryption (min 32 chars)
# If omitted, a default insecure key is used
CLAUDE_MCP_ENCRYPTION_KEY=your-32-char-minimum-secret-key-here
```

### 3. Run in development mode

```bash
pnpm dev
```

This starts:
- **Backend** (`tsx watch`) on port **3101** — auto-reloads on file changes
- **Frontend** (Vite) on port **3100** — HMR enabled, proxies `/api` to the backend

Open the admin panel at **http://localhost:3100**.

### 4. Set up integrations

#### GitHub

1. Go to **http://localhost:3100/connections** and click your GitHub connection (or create one)
2. Generate a Personal Access Token at [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
   - Required scopes: `repo`, `read:org`
3. Paste the token in the **Credentials** section and save

#### Jira

1. Create a Jira connection at **http://localhost:3100/connections** with:
   - **Name**: e.g. "Jira"
   - **Integration Type**: Jira
   - **Base URL**: Your Atlassian site URL (e.g. `https://yourcompany.atlassian.net`)
   - **Auth Method**: API Token
2. Generate an API token at [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
3. In the connection detail page, enter:
   - **Email**: Your Atlassian account email
   - **API Token**: The token you generated
4. Click **Save Credentials**

> Jira credentials are stored as encrypted JSON (`{email, apiToken}`) in the local SQLite database. Basic auth is used: `Authorization: Basic base64(email:apiToken)`.

---

## Using with Claude Code

### Configure MCP in your project

Create a `.mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "simple-mcp": {
      "command": "/path/to/claude_mcp/run-mcp.sh",
      "env": {
        "CLAUDE_MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

The `run-mcp.sh` script handles Node.js version management (via nvm), loads `.env`, and starts the server in stdio mode.

### Restart the MCP server

After making code changes, restart the MCP server in Claude Code:

```
/mcp
```

Select `simple-mcp` and restart. The new process will load the updated code.

### Using with Claude Desktop

Add to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "simple-mcp": {
      "command": "/path/to/claude_mcp/run-mcp.sh"
    }
  }
}
```

Restart Claude Desktop to connect.

## Using with Codex

Codex can use the same MCP server process exposed by this repository.

### Codex project configuration

Codex uses the root [`AGENTS.md`](/Users/heshan.kithuldora/Code/Learning/claude_mcp/AGENTS.md) file for repository-scoped instructions. This project now includes one with TypeScript, MCP, and agent-run guidance tailored for Codex.

### MCP connection

Reuse the existing project [`.mcp.json`](/Users/heshan.kithuldora/Code/Learning/claude_mcp/.mcp.json) server entry:

```json
{
  "mcpServers": {
    "simple-mcp": {
      "command": "/Users/heshan.kithuldora/Code/Learning/claude_mcp/run-mcp.sh",
      "env": {
        "CLAUDE_MCP_TRANSPORT": "stdio"
      }
    }
  }
}
```

Once Codex loads the project MCP server, it can call the same tools exposed to Claude clients.

### Recommended Codex workflow

For agentic development driven by Codex, use the tracked run tools instead of the server-side Anthropic loop:

1. Call `agent_list`
2. Call `agent_start_run`
3. Execute the relevant MCP tools
4. Call `agent_record_step` during execution
5. Call `agent_update_task` if the run includes planned tasks
6. Call `agent_complete_run` when done

This keeps execution history, task progress, and final results visible in the admin panel without requiring an Anthropic API key for the run itself.

---

## Project Structure

```
claude_mcp/
├── src/
│   ├── cli.ts                    # CLI entry point (bin: simple-mcp)
│   ├── cli/                      # CLI commands (start, stop, status, config)
│   ├── backend/
│   │   ├── server.ts             # Server bootstrap — wires all dependencies
│   │   ├── tools/                # MCP tool definitions
│   │   │   ├── jira/             # jira_search_issues, jira_create_issue, jira_transition_issue
│   │   │   ├── github/           # github_list_prs, github_review_pr, github_get_pr_diff, etc.
│   │   │   └── system/           # health_check, list_connections, agent_execute, agent_status, agent_list
│   │   ├── services/             # Business logic (jira.service, github.service, encryption.service)
│   │   ├── agents/               # Agent definitions, registry + execution engine
│   │   │   └── engine/           # Autonomous execution loop, guardrails, memory, planner
│   │   ├── db/                   # SQLite database (Drizzle ORM)
│   │   │   ├── client.ts         # DB connection + migration runner
│   │   │   ├── schema.ts         # Table definitions
│   │   │   └── repositories/     # Typed data access per table
│   │   ├── transports/           # stdio, SSE adapters
│   │   ├── middleware/           # Logging, rate limiting, error handling
│   │   ├── config/               # Env validation (Zod)
│   │   └── maintenance/          # Scheduled tasks (token refresh, health monitor)
│   ├── frontend/                 # React 19 admin panel
│   │   ├── routes/               # TanStack Router file-based routes
│   │   │   ├── connections/      # Connection management pages
│   │   │   ├── my-prs/           # GitHub PR dashboard
│   │   │   ├── reviews/          # AI review history
│   │   │   ├── agents/           # Agent configuration
│   │   │   ├── agent-executions/ # Execution list + detail pages
│   │   │   └── settings/         # Server settings
│   │   ├── api/                  # TanStack Query hooks + typed API client
│   │   └── components/           # Shared UI components
│   └── shared/                   # Types, schemas, utilities (used by both)
│       ├── result.ts             # Result<T, E> type + domain error types
│       └── schemas/              # Zod schemas (connection, integration)
├── .env                          # Environment variables (git-ignored)
├── AGENTS.md                     # Repository-scoped instructions for Codex
├── .mcp.json                     # MCP server config for Claude Code
├── run-mcp.sh                    # MCP launcher script
├── package.json
├── tsconfig.json                 # Path aliases: @backend/*, @frontend/*, @shared/*
├── vite.config.ts                # Frontend dev server + build
├── tsup.config.ts                # Backend build
└── drizzle.config.ts             # Drizzle ORM migration config
```

---

## Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start backend + frontend in dev mode |
| `pnpm dev:backend` | Start backend only (tsx watch, SSE transport) |
| `pnpm dev:frontend` | Start Vite dev server only |
| `pnpm build` | Build both backend and frontend |
| `pnpm build:backend` | Build backend with tsup |
| `pnpm build:frontend` | Build frontend with Vite |
| `pnpm test` | Run tests with Vitest |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm db:generate` | Generate Drizzle migrations |
| `pnpm db:migrate` | Run Drizzle migrations |

---

## Architecture

### Backend

- **Transport**: stdio (for Claude Code/Desktop) or SSE (for development)
- **MCP SDK**: Uses `McpServer` from `@modelcontextprotocol/sdk/server/mcp.js`
- **HTTP API**: Hono server on port 3101 for the admin panel REST API
- **Database**: Embedded SQLite at `~/.simple-mcp/data.db` with Drizzle ORM
- **Credentials**: AES-256-CBC encrypted before storage, decrypted on read
- **Error handling**: `Result<T, E>` pattern with typed domain errors — no throwing for expected failures

### Frontend

- **React 19** with function components only
- **TanStack Router** for file-based, type-safe routing
- **TanStack Query** for server state with automatic refresh
- **Zustand** for shared client state (when needed)
- **Vite** for development (HMR) and production builds

### Data Flow

```
Claude Code / Desktop / Codex
  ↕ stdio (JSON-RPC)
MCP Server (McpServer)
  → Tools → Services → External APIs (Jira, GitHub)
  → Resources / Prompts
  ↕ Drizzle ORM
SQLite (~/.simple-mcp/data.db)

Admin Panel (React)
  ↕ HTTP (fetch → /api/*)
Hono Server (:3101)
  → Connection Manager → Repositories → SQLite
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | No | — | Anthropic API key for AI-powered PR reviews |
| `CLAUDE_MCP_DB_PATH` | No | `~/.simple-mcp/data.db` | Path to SQLite database file |
| `CLAUDE_MCP_ADMIN_PORT` | No | `3101` | Admin panel HTTP server port |
| `CLAUDE_MCP_LOG_LEVEL` | No | `info` | Log level: trace, debug, info, warn, error, fatal |
| `CLAUDE_MCP_TRANSPORT` | No | `stdio` | MCP transport: stdio, sse, http |
| `CLAUDE_MCP_ENCRYPTION_KEY` | No | insecure default | Encryption key for stored credentials (min 32 chars) |

---

## Troubleshooting

### MCP tools return stale/empty data after code changes

The running MCP process loaded the old code at startup. Restart it:
- **Claude Code**: Type `/mcp`, select `simple-mcp`, restart
- **Claude Desktop**: Quit and reopen the app
- **Dev mode**: `tsx watch` auto-reloads, but stale processes from other sessions may hold port 3101 — kill them with `pkill -f 'tsx.*cli.ts start'`

### "No connected Jira/GitHub instance found"

The integration has no stored credentials, or the connection status is not `connected`. Go to the admin panel at `http://localhost:3100/connections`, open the connection, and save valid credentials.

### Port 3101 already in use

Another instance is running. Find and kill it:

```bash
lsof -i :3101 -sTCP:LISTEN
kill <PID>
```

### Jira API returns 410 Gone

Atlassian removed the legacy `/rest/api/3/search` endpoint. This project uses the new `/rest/api/3/search/jql` endpoint. If you see this error, ensure you're running the latest code and restart the MCP server.

---

## Agent Execution Engine — Full Guide

The agent execution engine lets agents run autonomously — you provide a goal, and the agent plans tasks, invokes MCP tools, reflects on results, and self-corrects until completion or a guardrail is hit.

### How It Works

```
                    ┌─────────────────┐
                    │    Your Goal    │
                    └────────┬────────┘
                             ▼
                    ┌─────────────────┐
                    │  Task Planner   │  Claude decomposes goal into sub-tasks
                    └────────┬────────┘
                             ▼
              ┌──────────────────────────────┐
              │     Execution Loop           │
              │                              │
              │  1. Check guardrails         │
              │  2. Send memory to Claude    │◀──────┐
              │  3. Claude picks tool(s)     │       │
              │  4. Execute tool(s)          │       │
              │  5. Summarize observations   │       │ Reflect
              │  6. Add results to memory    │───────┘
              │  7. Repeat or finish         │
              └──────────┬───────────────────┘
                         ▼
              ┌─────────────────────┐
              │   Result / Answer   │  Persisted in SQLite
              └─────────────────────┘
```

### Available Agents

| Agent ID | Name | Needs | Best For |
|---|---|---|---|
| `jira-triage` | Jira Triage Agent | Jira connection | Triaging, classifying, and prioritising Jira issues |
| `pr-review` | PR Review Agent | GitHub connection | Reviewing pull requests with inline comments |
| `code-search` | Code Search Agent | GitHub connection | Searching and analysing code across repositories |
| `sprint-planning` | Sprint Planning Agent | Jira connection | Sprint planning, backlog grooming, capacity analysis |
| `local-repo-analysis` | Local Repo Analysis Agent | Local filesystem folder | Analysing local repository structure and patterns |
| `confluence-reader` | Confluence Reader Agent | Jira connection | Reading and searching Confluence documentation |
| `database-explorer` | Database Explorer Agent | MySQL or PostgreSQL connection | Exploring schemas, running queries, suggesting optimisations |

> **Prerequisite:** Each agent requires its integration to be connected and healthy. Set up connections in the admin panel at `http://localhost:3100/connections` before executing an agent.

---

### Usage: Claude Code or Codex (Client-driven)

When the MCP server is connected to Claude Code or Codex, you can invoke agents directly in your conversation.

#### Execute an agent with the server-side execution engine

```
Use the agent_execute tool to run the database-explorer agent with goal:
"List all tables in the public schema and describe their columns and relationships"
```

The connected client calls `agent_execute`, which starts the server-managed autonomous loop. The agent plans, invokes database tools, and returns a complete answer.

#### Execute an agent with a client-driven tracked run

```
1. Use agent_start_run with agentId "local-repo-analysis" and a concrete goal.
2. Follow the returned systemPrompt and requiredTools.
3. Record progress with agent_record_step as you work.
4. Finish with agent_complete_run.
```

This mode is recommended for Codex because Codex stays in control of the reasoning loop while the MCP server still tracks execution history in SQLite and the admin UI.

#### Execute with custom limits

```
Use agent_execute to run jira-triage agent with goal:
"Find all unassigned P1 bugs in project PLATFORM and suggest owners based on recent commit history"

Set maxIterations to 10 and maxToolCalls to 30.
```

#### Check agent status

```
Use agent_status to check run ID "abc-123-def"
```

Returns iteration count, tool calls made, token usage, and current state.

#### List available agents

```
Use the agent_list tool to show me all available agents and their status
```

Shows all agents with `ready`, `missing_dependencies`, or `disabled` status.

#### Chain agent results with follow-up work

```
1. Use agent_execute with code-search agent to find all usages of the deprecated
   `fetchUser` function across our GitHub repositories.
2. Based on the results, create a Jira issue for each repository that needs updating.
```

---

### Usage: Claude Desktop App

Claude Desktop connects to the MCP server in the same way as Claude Code. After configuring the MCP server (see [Using with Claude Desktop](#using-with-claude-desktop) above):

1. **Start a conversation** and ask Claude to use the `agent_list` tool to see available agents
2. **Execute an agent** by asking Claude to use `agent_execute` with an agent ID and goal:
   > "Run the pr-review agent to review the latest open pull request in the heshansw/simple-mcp repository"
3. **The agent runs autonomously** — Claude shows you the progress and final result
4. **Check past runs** by asking Claude to use `agent_status` with a run ID

### Client-Driven Runs for Codex and Claude Code

The MCP server also exposes a client-driven execution path for coding agents that want to own the reasoning loop directly:

| Tool | Purpose |
|---|---|
| `agent_start_run` | Create a tracked run and return the selected agent's prompt, tools, and optional tasks |
| `agent_record_step` | Persist meaningful execution steps for observability |
| `agent_update_task` | Update task state for tracked plans |
| `agent_complete_run` | Finalize the run with completed, failed, or cancelled status |

Use this mode when you want Codex or Claude Code to reason locally while still writing execution telemetry into the project database and admin panel.

> **Tip:** Agent execution blocks until completion. For long-running agents, keep the conversation open. The default timeout is 5 minutes.

---

### Usage: Admin Panel (Frontend)

The React admin panel provides a visual interface for managing and monitoring agent executions.

#### Starting an Agent Execution

1. Open the admin panel at **http://localhost:3100**
2. Click **Executions** in the sidebar (or navigate to `/agent-executions`)
3. Click the **Execute Agent** button in the top-right corner
4. Fill out the form:
   - **Agent** — select from the dropdown (only agents with connected integrations appear)
   - **Goal** — describe what the agent should accomplish in plain language
   - *(Optional)* Click **Show advanced options** to override:
     - **Max Iterations** — how many plan→execute→reflect cycles (default: 25)
     - **Max Tool Calls** — total tool invocations allowed (default: 100)
     - **Max Tokens** — total Anthropic API tokens allowed (default: 200,000)
5. Click **Execute Agent** — the button shows "Executing..." while running
6. On completion, you are redirected to the execution detail page

#### Monitoring Executions

The **Executions** list page (`/agent-executions`) shows a table of all runs:

| Column | Description |
|---|---|
| Status | Color-coded badge: blue (planning), amber (executing), green (completed), red (failed), gray (cancelled) |
| Agent | Which agent ran |
| Goal | The goal text (truncated to 80 characters) |
| Iterations | Number of plan→execute→reflect cycles used |
| Tool Calls | Total tool invocations |
| Tokens | Total input + output tokens consumed |
| Duration | Wall-clock execution time |
| Started | When the run began (relative time) |

Click any row to open the detail page.

#### Execution Detail Page

The detail page (`/agent-executions/:runId`) shows:

- **Status badge** with auto-refresh indicator (pulsing dot when the run is still active)
- **Goal** — full goal text
- **Metrics grid** — Iterations, Tool Calls, Input Tokens, Output Tokens
- **Timing** — Started, Completed (or "In progress..."), Duration
- **Result section** (green border) — the agent's final answer, with summary metrics
- **Error section** (red border) — error message if the run failed
- **Cancel button** (red) — appears only for active runs (planning / executing state)

**Auto-refresh:** The detail page automatically polls every 3 seconds while the run is in `planning` or `executing` state. Once the run completes, fails, or is cancelled, polling stops.

#### Cancelling a Run

On the execution detail page, click the **Cancel Run** button (visible only for active runs). The run transitions to `cancelled` state and the auto-refresh picks up the new status.

---

### Usage: HTTP API (Direct)

You can also interact with the agent execution system directly via HTTP:

#### Start an execution

```bash
curl -X POST http://localhost:3101/api/agents/execute \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "database-explorer",
    "goal": "List all tables in the public schema and describe their relationships",
    "config": {
      "maxIterations": 10,
      "maxToolCalls": 50,
      "maxTokens": 100000
    }
  }'
```

**Response** (blocks until completion):
```json
{
  "runId": "run_abc123",
  "agentId": "database-explorer",
  "goal": "List all tables...",
  "answer": "The public schema contains 5 tables...",
  "tasksCompleted": 3,
  "toolCallsMade": 8,
  "iterationsUsed": 4,
  "inputTokensUsed": 12500,
  "outputTokensUsed": 3200,
  "durationMs": 15432
}
```

#### List recent runs

```bash
curl http://localhost:3101/api/agents/runs?limit=20
```

#### Get run status

```bash
curl http://localhost:3101/api/agents/runs/run_abc123
```

#### Cancel a run

```bash
curl -X POST http://localhost:3101/api/agents/runs/run_abc123/cancel
```

---

### Configuration & Guardrails

Every execution has safety guardrails that prevent runaway loops and excessive resource consumption:

| Guardrail | Default | Override | Purpose |
|---|---|---|---|
| Max Iterations | 25 | `maxIterations` | Caps plan→execute→reflect cycles |
| Max Tool Calls | 100 | `maxToolCalls` | Caps total tool invocations |
| Max Tokens | 200,000 | `maxTokens` | Caps total Anthropic API tokens |
| Timeout | 5 minutes | — | Wall-clock time limit (not configurable per-run) |
| Cycle Detection | 3 identical | — | Detects repeated identical tool calls |
| Delegation Depth | 2 | — | Max nesting for inter-agent delegation |

Override defaults by passing a `config` object when executing:

```json
{
  "agentId": "jira-triage",
  "goal": "Triage all unassigned bugs",
  "config": {
    "maxIterations": 10,
    "maxToolCalls": 30,
    "maxTokens": 50000
  }
}
```

### Inter-Agent Delegation

Agents can delegate sub-tasks to other agents. For example, the Sprint Planning agent might delegate a code search task to the Code Search agent. Delegation is automatic — if Claude determines that another agent is better suited for a sub-task, it uses the `delegate_to_agent` internal tool.

**Constraints:**
- Maximum delegation depth: 2 (A → B → C is allowed, but C cannot delegate further)
- Parent context is summarised to 2000 characters when passed to the child agent
- Both parent and child runs are persisted and visible in the admin panel

### Anthropic API Key

The execution engine requires an Anthropic API key for Claude reasoning calls. It resolves the key in this order:

1. `ANTHROPIC_API_KEY` environment variable
2. Anthropic connection stored in the database (via admin panel)

Set at least one before executing agents.

---

## License

Private — not published.
