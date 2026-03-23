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


### Pre-built Agents

- **Jira Triage** — Automated issue triage and classification
- **PR Review** — AI-powered code review with inline GitHub comments
- **Code Search** — Semantic code search across repositories
- **Sprint Planning** — Sprint planning assistance

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
│   │   │   └── system/           # health_check, list_connections
│   │   ├── services/             # Business logic (jira.service, github.service, encryption.service)
│   │   ├── agents/               # Agent definitions + registry
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
│   │   │   └── settings/         # Server settings
│   │   ├── api/                  # TanStack Query hooks + typed API client
│   │   └── components/           # Shared UI components
│   └── shared/                   # Types, schemas, utilities (used by both)
│       ├── result.ts             # Result<T, E> type + domain error types
│       └── schemas/              # Zod schemas (connection, integration)
├── .env                          # Environment variables (git-ignored)
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
Claude Code / Desktop
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

## License

Private — not published.
