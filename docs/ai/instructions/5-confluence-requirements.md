# 5 — Confluence Integration Requirements

> **Status:** Pending Implementation
> **Created:** 2026-03-25

---

## 1. Context & Business Value

**Goal:** Expose Confluence as a **read-only** MCP integration so Claude agents can search, retrieve, and list Confluence pages to answer questions grounded in existing team documentation — without agents needing to leave the MCP context or the user having to paste page content manually.

**Target Audience:** Developers and analysts who use Confluence as their team knowledge base and want Claude agents to reference live documentation during sessions.

**Scope:** Read-only. Three operations: search pages via CQL, retrieve a single page as Markdown, list accessible spaces. No write, create, update, or delete operations.

**Key Design Constraint (Q1):** Confluence **reuses the existing Jira connection** — same Atlassian `siteUrl`, same `{ email, apiToken }` credentials stored under the Jira connection record. No new connection entry is created. Confluence tools check for an active Jira connection at invocation time.

---

## 2. System Architecture & Integrations

### Dependencies

| Dependency | Purpose |
|---|---|
| Existing Jira connection (`connectionsTable`) | Source of `siteUrl` and `{ email, apiToken }` credentials |
| Existing `getConnectionInfo()` pattern (`jira.service.ts`) | Reused verbatim — Confluence service takes the same dependency shape |
| Existing `serverSettingsTable` + `ServerSettingsRepository` | Stores the space allowlist as a JSON value under a namespaced key — **no new table required** |
| `node-html-markdown` (new npm dep) | Converts Confluence storage format (XHTML) to Markdown at the service layer |
| Confluence REST API v1 | `${siteUrl}/wiki/rest/api/` — same Basic auth as Jira |

### Communication

- Admin panel → Management API (Hono HTTP): one new endpoint to read/write the space allowlist setting.
- Claude agent → MCP server: 3 new MCP tools over existing stdio/SSE/HTTP transports.
- MCP server → Confluence Cloud: HTTPS REST calls using `fetch`, Basic auth (`email:apiToken` base64 encoded).

### No Changes to Connection Schema

`integrationType` enum is **not extended**. Confluence is surfaced as tools on top of the Jira integration — it is not a separate connection type. The `ConnectionConfigSchema` and `connectionsTable` are unchanged.

### New Files Required

```
src/backend/
  services/confluence.service.ts
  tools/confluence/
    confluence-search-pages.tool.ts
    confluence-get-page.tool.ts
    confluence-list-spaces.tool.ts

src/shared/schemas/
  confluence.schema.ts          ← Zod schemas for API shapes, shared with frontend
```

### Codebase Touch Points (changes to existing files)

| File | Change |
|---|---|
| `src/backend/server.ts` | Instantiate `ConfluenceService`; register 3 new tools |
| `src/backend/agents/` | Add `confluence-reader.agent.ts` |
| `src/backend/agents/index.ts` | Export new agent |
| `src/backend/agents/registry.ts` | Register new agent |
| Admin API HTTP routes (Hono) | Add `GET/PUT /api/confluence/settings` for space allowlist management |

---

## 3. Data Models & State

### No New DB Table

The space allowlist is persisted in the **existing** `server_settings` table as a single JSON-encoded row:

```
key:   "confluence.allowed_space_keys"
value: '["ENG","DOCS","ARCH"]'         — JSON array of Confluence space keys (uppercase)
```

- An empty array (`[]`) means **all spaces** the Atlassian account can access are permitted.
- This key is read on every tool invocation — no in-process caching (settings can change without restart).
- Written via the existing `ServerSettingsRepository.upsert()` method — no new repository required.

### Confluence Page (internal read shape)

```
page_id:        string          — Confluence numeric page ID (e.g. "123456789")
title:          string
space_key:      string          — e.g. "ENG"
space_name:     string          — e.g. "Engineering"
url:            string          — canonical browser URL of the page
version:        integer         — current version number
last_modified:  ISO 8601 string
author:         { display_name: string, account_id: string }
content_markdown: string        — storage format converted to Markdown
ancestors:      { id: string, title: string }[]  — breadcrumb path
```

### Confluence Space (internal read shape)

```
space_key:      string          — e.g. "ENG"
name:           string          — e.g. "Engineering"
type:           "global" | "personal"
url:            string          — browser URL to space homepage
description:    string | null
```

### Zod Schemas (`src/shared/schemas/confluence.schema.ts`)

```typescript
export const ConfluencePageSchema = z.object({
  pageId:          z.string().min(1),
  title:           z.string(),
  spaceKey:        z.string(),
  spaceName:       z.string(),
  url:             z.string().url(),
  version:         z.number().int().positive(),
  lastModified:    z.string().datetime(),
  author:          z.object({ displayName: z.string(), accountId: z.string() }),
  contentMarkdown: z.string(),
  ancestors:       z.array(z.object({ id: z.string(), title: z.string() })),
});

export const ConfluenceSpaceSchema = z.object({
  spaceKey:    z.string().min(1),
  name:        z.string(),
  type:        z.enum(["global", "personal"]),
  url:         z.string().url(),
  description: z.string().nullable(),
});

export const ConfluenceSearchResultSchema = z.object({
  pageId:       z.string().min(1),
  title:        z.string(),
  spaceKey:     z.string(),
  spaceName:    z.string(),
  url:          z.string().url(),
  lastModified: z.string().datetime(),
  excerpt:      z.string(),   // plain-text excerpt from the search hit (provided by Confluence API)
});

export const AllowedSpaceKeysSchema = z.array(
  z.string().min(1).max(255).toUpperCase()
);

export type ConfluencePage         = z.infer<typeof ConfluencePageSchema>;
export type ConfluenceSpace        = z.infer<typeof ConfluenceSpaceSchema>;
export type ConfluenceSearchResult = z.infer<typeof ConfluenceSearchResultSchema>;
export type AllowedSpaceKeys       = z.infer<typeof AllowedSpaceKeysSchema>;
```

---

## 4. API Contracts / Interfaces

### 4.1 Admin REST Endpoints (Hono HTTP layer)

#### `GET /api/confluence/settings`
Retrieve current Confluence settings — specifically the allowed space keys.

**Response `200`:**
```json
{
  "allowedSpaceKeys": ["ENG", "DOCS", "ARCH"]
}
```
Returns `{ "allowedSpaceKeys": [] }` if the setting has never been set (meaning all spaces permitted).

---

#### `PUT /api/confluence/settings`
Update the space allowlist.

**Request body:**
```json
{
  "allowedSpaceKeys": ["ENG", "DOCS"]
}
```

**Validation rules:**
- `allowedSpaceKeys` must be an array of strings (can be empty).
- Each key is uppercased before storage.
- Max 50 space keys per allowlist.

**Response `200`:**
```json
{ "allowedSpaceKeys": ["ENG", "DOCS"] }
```

**Note:** This endpoint does **not** validate that the provided space keys actually exist in Confluence — validation happens lazily at tool invocation time. The intent is to not require a live Confluence connection to configure the allowlist.

---

### 4.2 MCP Tool Contracts

#### `confluence_search_pages`
Search Confluence pages using CQL (Confluence Query Language).

**Input:**
```json
{
  "cql":         "string (required) — CQL query e.g. 'text ~ \"authentication\" AND space = \"ENG\"'",
  "max_results": "integer 1–50 (default: 10)"
}
```

**Output:**
```json
{
  "total":   42,
  "results": [
    {
      "pageId":       "123456789",
      "title":        "Authentication Flow",
      "spaceKey":     "ENG",
      "spaceName":    "Engineering",
      "url":          "https://acme.atlassian.net/wiki/spaces/ENG/pages/123456789",
      "lastModified": "2026-03-01T12:00:00Z",
      "excerpt":      "...the OAuth 2.0 flow begins when the client redirects..."
    }
  ]
}
```

**Confluence API call:** `GET /wiki/rest/api/content/search?cql={cql}&limit={max_results}&expand=space,version`

**Allowlist enforcement:** If `allowedSpaceKeys` is non-empty, the service **prepends** a CQL clause to every query: `space IN ("ENG","DOCS") AND ({user_cql})`. The user never sees or controls this injection — it is applied silently at the service layer before the API call.

---

#### `confluence_get_page`
Retrieve the full content of a single Confluence page, returned as Markdown.

**Input:**
```json
{
  "page_id": "string (required) — numeric Confluence page ID"
}
```

**Output:**
```json
{
  "pageId":          "123456789",
  "title":           "Authentication Flow",
  "spaceKey":        "ENG",
  "spaceName":       "Engineering",
  "url":             "https://acme.atlassian.net/wiki/spaces/ENG/pages/123456789",
  "version":         7,
  "lastModified":    "2026-03-01T12:00:00Z",
  "author":          { "displayName": "Alice Smith", "accountId": "abc123" },
  "contentMarkdown": "## Overview\n\nThe OAuth 2.0 flow begins...",
  "ancestors":       [
    { "id": "100000001", "title": "Engineering Docs" },
    { "id": "100000012", "title": "Security" }
  ]
}
```

**Confluence API call:** `GET /wiki/rest/api/content/{page_id}?expand=body.storage,space,version,ancestors,history.lastUpdated`

**Content conversion:** The `body.storage.value` field (Atlassian Storage Format — XHTML) is converted to Markdown using `node-html-markdown` at the service layer before being returned. Conversion happens synchronously in-process; no external service call.

**Allowlist enforcement:** After fetching the page, the service checks `page.space.key` against `allowedSpaceKeys`. If the page belongs to a non-allowed space, return `PERMISSION_DENIED` — do NOT return the page content.

---

#### `confluence_list_spaces`
List Confluence spaces accessible to the authenticated account, filtered to the configured allowlist.

**Input:**
```json
{
  "type":        "global | personal | all (default: global)",
  "max_results": "integer 1–50 (default: 25)"
}
```

**Output:**
```json
{
  "total":  8,
  "spaces": [
    {
      "spaceKey":    "ENG",
      "name":        "Engineering",
      "type":        "global",
      "url":         "https://acme.atlassian.net/wiki/spaces/ENG",
      "description": "Main engineering knowledge base"
    }
  ]
}
```

**Confluence API call:** `GET /wiki/rest/api/space?type={type}&limit={max_results}&expand=description.plain`

**Allowlist enforcement:** If `allowedSpaceKeys` is non-empty, filter the Confluence API response to only include spaces whose key is in the allowlist. This filtering happens in-process after the API response — the full list is fetched, then reduced.

---

### 4.3 ConfluenceService Interface (`src/backend/services/confluence.service.ts`)

```typescript
export type ConfluenceDependencies = {
  /**
   * Identical shape to JiraDependencies.getConnectionInfo.
   * Returns siteUrl + decrypted { email, apiToken } from the active Jira connection.
   * Returns null when no connected Jira connection exists.
   */
  getConnectionInfo: () => Promise<{ siteUrl: string; credentials: JiraCredentials } | null>;
  getAllowedSpaceKeys: () => Promise<AllowedSpaceKeys>;  // reads serverSettingsTable
  logger: Logger;
};

export interface ConfluenceService {
  searchPages(cql: string, maxResults: number): Promise<Result<ConfluenceSearchResult[], DomainError>>;
  getPage(pageId: string): Promise<Result<ConfluencePage, DomainError>>;
  listSpaces(type: "global" | "personal" | "all", maxResults: number): Promise<Result<ConfluenceSpace[], DomainError>>;
}
```

**`getConnectionInfo` reuse:** `ConfluenceService` calls the **same** `getConnectionInfo` factory used by `JiraService`. No separate credential lookup is needed. The implementation in `server.ts` will pass the same closure to both services.

**HTTP client:** Uses native `fetch` with `Authorization: Basic ${base64(email:apiToken)}` header — identical to how `JiraService` authenticates. No new HTTP client library.

---

## 5. Strict Business Rules & Logic

1. **Jira connection prerequisite:** Every Confluence tool invocation calls `getConnectionInfo()` first. If it returns `null` (no active Jira connection), return `UNAUTHENTICATED` immediately — do NOT attempt any Confluence API call.
2. **CQL allowlist injection (search):** If `allowedSpaceKeys` is non-empty, the service silently rewrites the user's CQL from `{user_cql}` to `space IN ("KEY1","KEY2") AND ({user_cql})` before sending to the API. The agent never sees the injected clause and cannot override it.
3. **Space check on page fetch:** After retrieving a page via `confluence_get_page`, validate `page.space.key` is in `allowedSpaceKeys` (if the list is non-empty). Return `PERMISSION_DENIED` if not — even though the user provided the page ID directly.
4. **Space list filtering:** `confluence_list_spaces` fetches up to `max_results` spaces from the API, then post-filters in-process. The `total` field in the response reflects the **filtered count**, not the raw Confluence total.
5. **Markdown conversion scope:** Only the page body (`body.storage.value`) is converted to Markdown. Metadata fields (`title`, `author`, etc.) are returned as plain strings — never converted.
6. **Content size guard:** If `body.storage.value` exceeds **500 KB** before conversion, return `PAYLOAD_TOO_LARGE` — do NOT attempt conversion. Large pages should be searched for excerpts via `confluence_search_pages` instead.
7. **`max_results` hard cap:** Both `confluence_search_pages` and `confluence_list_spaces` cap at 50 results maximum, regardless of input.
8. **No credentials in tool output:** The `siteUrl`, `email`, and `apiToken` must never appear in any tool response or log line. Log the Confluence page ID or space key only.
9. **Space key normalisation:** All space keys from user input are uppercased before comparison and storage. `"eng"` and `"ENG"` are treated identically.
10. **Allowlist empty = open:** An empty `allowedSpaceKeys` array means no filtering — all spaces the Atlassian account can access are reachable. This is the default out-of-box state.

---

## 6. Edge Cases & Error Handling

| Scenario | Error `_tag` | HTTP/MCP Response |
|---|---|---|
| No active Jira connection | `UNAUTHENTICATED` | 401 + `{ hint: "Configure and connect a Jira integration first" }` |
| Jira connection exists but credentials missing | `UNAUTHENTICATED` | 401 |
| Confluence API 401 (bad token) | `UNAUTHENTICATED` | 401 — do NOT echo credentials |
| Confluence API 403 (insufficient scope) | `PERMISSION_DENIED` | 403 + `{ required_scope: "read:confluence-content.all" }` |
| Page belongs to non-allowed space | `PERMISSION_DENIED` | 403 + `{ space_key: "RESTRICTED" }` |
| `page_id` not found (Confluence 404) | `NOT_FOUND` | 404 |
| CQL syntax error (Confluence 400) | `INVALID_ARGUMENT` | 400 + Confluence error message (sanitized) |
| Page body > 500 KB | `PAYLOAD_TOO_LARGE` | 413 + `{ hint: "Use confluence_search_pages for excerpts" }` |
| Confluence API 429 (rate limited) | `RATE_LIMITED` | 429 + `retry_after_seconds` from response header if present |
| Confluence API 5xx | `UPSTREAM_ERROR` | 502 — do NOT leak raw Confluence error body |
| `max_results` > 50 (input validation) | `INVALID_ARGUMENT` | 400 + `{ max: 50 }` |
| Space allowlist contains > 50 keys | `INVALID_ARGUMENT` (on PUT settings) | 400 + `{ max: 50 }` |
| Network timeout (> 10s) | `DEADLINE_EXCEEDED` | 504 |
| Markdown conversion failure | `INTERNAL` | 500 — log raw storage format length server-side; return generic message |

All errors follow the `Result<T, DomainError>` pattern. Never throw from service layer.

---

## 7. Acceptance Criteria (BDD)

**Search — happy path**
- **Given** an active Jira connection with valid credentials, allowlist `["ENG"]`, and 3 ENG pages matching `text ~ "auth"`
- **When** `confluence_search_pages` is called with `cql: 'text ~ "auth"'`, `max_results: 10`
- **Then** returns 3 results, all with `spaceKey: "ENG"`, each with a non-empty `excerpt`

**Search — allowlist injection transparent to agent**
- **Given** allowlist `["ENG"]` and agent submits `cql: 'text ~ "payments"'`
- **When** `confluence_search_pages` is called
- **Then** the Confluence API receives `space IN ("ENG") AND (text ~ "payments")` — the agent receives only ENG results; no mention of the injected clause appears in the response

**Get page — Markdown conversion**
- **Given** a page in the `ENG` space with a storage format body containing an `<h2>` and a `<ul>`
- **When** `confluence_get_page` is called with that page's ID
- **Then** `contentMarkdown` contains `## ` (h2) and `- ` (list items) — valid Markdown equivalents

**Get page — allowlist enforcement**
- **Given** allowlist `["ENG"]` and a page that exists in space `LEGAL`
- **When** `confluence_get_page` is called with that page's ID
- **Then** returns `PERMISSION_DENIED` — page content is NOT returned

**List spaces — filtered by allowlist**
- **Given** allowlist `["ENG", "DOCS"]`, Atlassian account can see 10 spaces (including ENG and DOCS)
- **When** `confluence_list_spaces` is called
- **Then** returns exactly 2 spaces (`ENG`, `DOCS`); `total: 2`

**List spaces — no allowlist**
- **Given** `allowedSpaceKeys: []` (empty — all permitted), account can see 5 global spaces
- **When** `confluence_list_spaces` is called with `type: "global"`
- **Then** returns all 5 spaces

**No Jira connection**
- **Given** no Jira connection is configured in the admin panel
- **When** any Confluence tool is called
- **Then** returns `UNAUTHENTICATED` with the hint to configure Jira first — no Confluence API call is made

**Rate limit handling**
- **Given** Confluence API returns `429 Too Many Requests` with `Retry-After: 30`
- **When** any Confluence tool is called
- **Then** returns `RATE_LIMITED` with `retry_after_seconds: 30` — no retry is attempted by the server

**Oversized page**
- **Given** a page whose storage format body is 600 KB
- **When** `confluence_get_page` is called
- **Then** returns `PAYLOAD_TOO_LARGE` — Markdown conversion is NOT attempted

**Agent: confluence-reader**
- **Given** the `confluence-reader` agent is enabled and an active Jira connection exists
- **When** an agent session starts
- **Then** the agent has access to `confluence_search_pages`, `confluence_get_page`, and `confluence_list_spaces`
- **And** the agent's system prompt instructs it to search before fetching, to avoid unnecessary full-page retrievals
