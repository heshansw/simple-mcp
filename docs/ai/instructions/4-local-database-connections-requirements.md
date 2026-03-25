# 4 — Local Database Connections (MySQL & PostgreSQL) Requirements

> **Status:** Pending Implementation
> **Created:** 2026-03-24

---

## 1. Context & Business Value

**Goal:** Allow the admin panel user to register connections to **locally-running MySQL and PostgreSQL instances**. Once registered, Claude agents connecting via MCP can explore schemas, describe tables, and execute read queries against those databases — enabling data analysis, debugging, and schema documentation workflows without leaving the MCP ecosystem.

**Target Audience:** Developers and analysts running local database instances who want Claude agents to query and reason over live data.

**Scope:**
- Schema introspection (list databases/schemas, list tables, describe columns and indexes).
- Data queries: `SELECT` only by default. Write access (`INSERT`/`UPDATE`/`DELETE`) is opt-in per-connection and off by default.
- No DDL (`CREATE`, `DROP`, `ALTER`) under any configuration.

---

## 2. System Architecture & Integrations

### Dependencies

| Package | Purpose |
|---|---|
| `mysql2/promise` | MySQL connection pool (async/await API) |
| `pg` (node-postgres) | PostgreSQL connection pool |
| Existing `connectionsTable` (SQLite) | Stores DB connection metadata |
| Existing `credentialsTable` (SQLite) | Stores encrypted connection credentials |
| Existing `encryptionService` | AES-256-CBC encrypt/decrypt for credentials |

> **No new tables required.** The existing `connections` + `credentials` tables are sufficient. The `integrationType` and `authMethod` enums are extended.

### Communication

- Admin panel → Management API (Hono HTTP): REST CRUD for DB connection management.
- Claude agent → MCP server: new MCP tools over existing stdio/SSE/HTTP transports.
- MCP server → local DB: direct TCP via `mysql2` / `pg` connection pool.

### New Files Required

```
src/backend/
  services/database-query.service.ts       ← dialect-agnostic query orchestrator
  services/drivers/
    mysql.driver.ts                        ← mysql2 pool wrapper
    postgres.driver.ts                     ← pg pool wrapper
    database-driver.interface.ts           ← shared interface

  tools/local-database/
    db-query.tool.ts
    db-list-schemas.tool.ts
    db-list-tables.tool.ts
    db-describe-table.tool.ts

src/shared/schemas/
  database-connection.schema.ts            ← Zod schema, shared with frontend
```

### Codebase Touch Points (changes to existing files)

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `DatabaseConnectionId` branded type |
| `src/shared/schemas/connection.schema.ts` | Add `"mysql"` and `"postgres"` to `integrationType` enum |
| `src/shared/schemas/connection.schema.ts` | Add `"connection_string"` and `"username_password"` to `AuthMethodSchema` |
| `src/backend/db/schema.ts` | Add `databaseDialect` and `allowWrites` columns to `connectionsTable` (nullable, only relevant when `integrationType` is `mysql` or `postgres`) |
| `src/backend/db/migrations/` | Migration adding `database_dialect TEXT` and `allow_writes INTEGER DEFAULT 0` columns to `connections` |
| `src/backend/services/connection-manager.service.ts` | Handle `mysql`/`postgres` in `createConnection`, `testConnection` |
| `src/backend/server.ts` | Instantiate drivers, register 4 new tools |
| `src/backend/agents/` | Add `database-explorer.agent.ts` |
| `src/backend/agents/index.ts` + `registry.ts` | Export and register new agent |
| Admin API HTTP routes | CRUD already handled by existing `/api/connections` endpoints — extend `integrationType` validation only |

---

## 3. Data Models & State

### Extended `connections` Table Columns (migration required)

Two new nullable columns added to the existing `connectionsTable`:

```
database_dialect:  TEXT NULL   — "mysql" | "postgres" (only set when integrationType is mysql/postgres)
allow_writes:      INTEGER NOT NULL DEFAULT 0  — 0 = read-only, 1 = allow INSERT/UPDATE/DELETE
```

### Credentials Shape (stored AES-256 encrypted in `credentials.encrypted_data`)

Two supported auth methods. The plaintext JSON blob (before encryption) has the shape:

**`username_password` method:**
```json
{
  "host":     "127.0.0.1",
  "port":     3306,
  "database": "my_app_db",
  "username": "dev_user",
  "password": "s3cr3t"
}
```

**`connection_string` method:**
```json
{
  "connectionString": "mysql://dev_user:s3cr3t@127.0.0.1:3306/my_app_db"
}
```

> Both shapes are validated on write via a Zod union schema before encryption. The plaintext is **never** returned to the frontend or logged.

### Zod Schema (`src/shared/schemas/database-connection.schema.ts`)

```typescript
export const DatabaseDialectSchema = z.enum(["mysql", "postgres"]);

export const DbCredentialsUsernamePasswordSchema = z.object({
  host:     z.string().min(1),
  port:     z.number().int().min(1).max(65535),
  database: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
});

export const DbCredentialsConnectionStringSchema = z.object({
  connectionString: z.string().min(1),
});

export const DbCredentialsSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("username_password"), ...DbCredentialsUsernamePasswordSchema.shape }),
  z.object({ method: z.literal("connection_string"),  ...DbCredentialsConnectionStringSchema.shape }),
]);

export type DbCredentials = z.infer<typeof DbCredentialsSchema>;

export const DatabaseConnectionConfigSchema = z.object({
  id:           z.string().min(1),
  name:         z.string().min(1).max(100),
  dialect:      DatabaseDialectSchema,
  allowWrites:  z.boolean().default(false),
  status:       ConnectionStatusSchema,           // reuse from connection.schema.ts
  createdAt:    z.string().datetime(),
  updatedAt:    z.string().datetime(),
});

export type DatabaseConnectionConfig = z.infer<typeof DatabaseConnectionConfigSchema>;
```

### Mermaid ER Diagram

```mermaid
erDiagram
    CONNECTIONS {
        text id PK
        text name
        text integration_type
        text base_url
        text auth_method
        text status
        text database_dialect "nullable: mysql | postgres"
        integer allow_writes "default 0"
        text created_at
        text updated_at
    }
    CREDENTIALS {
        text id PK
        text connection_id FK
        text encrypted_data
        text iv
        text algorithm
        text created_at
        text updated_at
    }
    CONNECTIONS ||--o| CREDENTIALS : "has"
```

---

## 4. API Contracts / Interfaces

### 4.1 Admin REST Endpoints

Database connections are managed through the **existing** `/api/connections` endpoints. No new routes are needed. The only change is that `integrationType` now accepts `"mysql"` and `"postgres"`.

#### `POST /api/connections` — Creating a DB connection

**Request body:**
```json
{
  "name":            "local-mysql-dev",
  "integrationType": "mysql",
  "authMethod":      "username_password",
  "allowWrites":     false
}
```

#### `POST /api/connections/:id/credentials` — Storing encrypted credentials

**Request body (never stored in plaintext):**
```json
{
  "method":   "username_password",
  "host":     "127.0.0.1",
  "port":     3306,
  "database": "my_app_db",
  "username": "dev_user",
  "password": "s3cr3t"
}
```
The body is validated by `DbCredentialsSchema`, then serialized to JSON and encrypted via `encryptionService.encrypt()` before storage. **This endpoint must use HTTPS in production.** Response: `204 No Content`.

#### `POST /api/connections/:id/test`
Attempt a real connection using the decrypted credentials. Executes `SELECT 1` as a liveness probe.

**Response `200`:**
```json
{ "status": "connected", "dialect": "mysql", "latency_ms": 4 }
```

**Response `503`:**
```json
{ "status": "error", "error": "Connection refused at 127.0.0.1:3306" }
```

---

### 4.2 MCP Tool Contracts

#### `db_list_schemas`
List all databases/schemas accessible via the connection.

**Input:**
```json
{
  "connection_id": "string (required)"
}
```

**Output:**
```json
{
  "dialect":  "mysql",
  "schemas":  ["my_app_db", "test_db", "information_schema"]
}
```

---

#### `db_list_tables`
List all tables in a given schema.

**Input:**
```json
{
  "connection_id": "string (required)",
  "schema_name":   "string (required)"
}
```

**Output:**
```json
{
  "schema":  "my_app_db",
  "tables": [
    { "name": "users", "type": "BASE TABLE", "row_count_estimate": 15200 },
    { "name": "user_sessions", "type": "BASE TABLE", "row_count_estimate": 43000 }
  ]
}
```

---

#### `db_describe_table`
Return full column metadata, primary keys, indexes, and foreign keys for a table.

**Input:**
```json
{
  "connection_id": "string (required)",
  "schema_name":   "string (required)",
  "table_name":    "string (required)"
}
```

**Output:**
```json
{
  "schema":  "my_app_db",
  "table":   "users",
  "columns": [
    { "name": "id",         "type": "bigint unsigned", "nullable": false, "default": null, "primary_key": true, "auto_increment": true },
    { "name": "email",      "type": "varchar(255)",    "nullable": false, "default": null, "primary_key": false },
    { "name": "created_at", "type": "datetime",        "nullable": false, "default": "CURRENT_TIMESTAMP" }
  ],
  "indexes": [
    { "name": "PRIMARY",    "unique": true,  "columns": ["id"] },
    { "name": "idx_email",  "unique": true,  "columns": ["email"] }
  ],
  "foreign_keys": [
    { "column": "role_id", "references_table": "roles", "references_column": "id", "on_delete": "SET NULL" }
  ]
}
```

---

#### `db_query`
Execute a SQL query against the connection. Read-only by default; write operations require `allow_writes: true` on the connection.

**Input:**
```json
{
  "connection_id":  "string (required)",
  "sql":            "string (required) — the SQL statement to execute",
  "params":         "array (optional) — positional parameters for parameterized queries",
  "max_rows":       "integer 1–1000 (default: 100)",
  "timeout_ms":     "integer 500–30000 (default: 5000)"
}
```

**Output:**
```json
{
  "rows":          [ { "id": 1, "email": "user@example.com" } ],
  "row_count":     1,
  "columns":       ["id", "email"],
  "truncated":     false,
  "execution_ms":  3
}
```

---

### 4.3 DatabaseDriver Interface (`src/backend/services/drivers/database-driver.interface.ts`)

```typescript
export interface QueryResult {
  readonly rows:        Record<string, unknown>[];
  readonly columns:     string[];
  readonly rowCount:    number;
  readonly truncated:   boolean;
  readonly executionMs: number;
}

export interface DatabaseDriver {
  query(sql: string, params: unknown[], options: QueryOptions): Promise<Result<QueryResult, DomainError>>;
  listSchemas(): Promise<Result<string[], DomainError>>;
  listTables(schema: string): Promise<Result<TableInfo[], DomainError>>;
  describeTable(schema: string, table: string): Promise<Result<TableDescription, DomainError>>;
  testConnection(): Promise<Result<{ latencyMs: number }, DomainError>>;
  close(): Promise<void>;
}
```

> `MysqlDriver` and `PostgresDriver` both implement `DatabaseDriver`. `DatabaseQueryService` holds a `Map<ConnectionId, DatabaseDriver>` as a connection pool registry.

---

## 5. Strict Business Rules & Logic

1. **Write guard (critical):** Before executing any SQL via `db_query`, parse the first non-whitespace keyword of the normalized SQL string. If it is NOT `SELECT` or `WITH` and `allowWrites === false`, reject immediately with `PERMISSION_DENIED`. Never rely solely on database user permissions.
2. **DDL always blocked:** Even when `allow_writes === true`, statements beginning with `CREATE`, `DROP`, `ALTER`, `TRUNCATE`, or `RENAME` are rejected with `PERMISSION_DENIED`. This is enforced at the service layer, not the DB layer.
3. **Parameterized queries only:** `db_query` uses driver-native parameterized query APIs (`?` for MySQL, `$1` for PostgreSQL). No string concatenation of user-supplied values into SQL.
4. **Row cap:** Results are capped at `min(max_rows, 1000)`. If the underlying result set has more rows, `truncated: true` is set in the response.
5. **Query timeout:** Every query is executed with a driver-level timeout of `timeout_ms` (default 5000ms). On timeout, return `DEADLINE_EXCEEDED`.
6. **Connection pool per registered connection:** Each active DB connection has a pool of max **5** connections. Idle connections are released after **30 seconds**.
7. **No credentials in logs:** Credentials (host, port, username, password, connection string) are never written to pino logs at any level. Log `connection_id` only.
8. **`status` check before query:** If the connection's `status !== "connected"`, return `UNAVAILABLE`. The agent must call `POST /api/connections/:id/test` to re-establish.
9. **`information_schema` / system schema access:** Agents may query `information_schema` for MySQL and `pg_catalog`/`information_schema` for PostgreSQL via `db_query`. This is read-only by definition and is NOT blocked.
10. **`allow_writes` toggle:** Changing `allow_writes` from `true` to `false` takes effect immediately on the next tool call — no restart required.

---

## 6. Edge Cases & Error Handling

| Scenario | Error `_tag` | HTTP/MCP Response |
|---|---|---|
| Write statement attempted, `allow_writes: false` | `PERMISSION_DENIED` | 403 + `{ statement_type: "INSERT" }` |
| DDL statement attempted (any config) | `PERMISSION_DENIED` | 403 + `{ statement_type: "DROP" }` |
| SQL syntax error | `INVALID_ARGUMENT` | 400 + driver error message (sanitized) |
| Query times out | `DEADLINE_EXCEEDED` | 504 + `{ timeout_ms: 5000 }` |
| Row count exceeds `max_rows` | — (not an error) | 200 + `{ truncated: true }` |
| Connection pool exhausted (all 5 busy) | `RESOURCE_EXHAUSTED` | 503 + `retry_after_ms: 1000` |
| TCP connection refused (DB not running) | `UNAVAILABLE` | 503 — do NOT include host/port in response |
| Auth failure (wrong password) | `UNAUTHENTICATED` | 401 — do NOT echo credentials |
| `connection_id` not found in DB | `NOT_FOUND` | 404 |
| `connection.status !== "connected"` | `UNAVAILABLE` | 503 + `{ hint: "run POST /api/connections/:id/test" }` |
| Driver crash / unexpected error | `INTERNAL` | 500 — full error logged server-side, generic message to agent |
| Malformed `params` array (type mismatch) | `INVALID_ARGUMENT` | 400 |

All errors follow the `Result<T, DomainError>` pattern. Service layer never throws. Credentials must never appear in any error message returned to the MCP client.

---

## 7. Acceptance Criteria (BDD)

**Schema listing**
- **Given** a connected MySQL connection with 3 accessible databases
- **When** `db_list_schemas` is called
- **Then** returns an array of 3 schema names

**Table listing**
- **Given** a connected PostgreSQL connection with `my_app_db` containing 5 tables
- **When** `db_list_tables` is called with `schema_name: "my_app_db"`
- **Then** returns exactly 5 table entries with `name`, `type`, and `row_count_estimate`

**Table description**
- **Given** a `users` table with 3 columns, 2 indexes, and 1 foreign key
- **When** `db_describe_table` is called for that table
- **Then** returns all 3 columns, 2 indexes, and 1 foreign key in the output

**Read query succeeds**
- **Given** a connected connection with `allow_writes: false` and a `users` table with 50 rows
- **When** `db_query` is called with `sql: "SELECT id, email FROM users LIMIT 10"`
- **Then** returns exactly 10 rows, `truncated: false`, `columns: ["id", "email"]`

**Row cap enforced**
- **Given** a table with 5000 rows
- **When** `db_query` is called with `sql: "SELECT * FROM large_table"` and `max_rows: 100`
- **Then** returns 100 rows and `truncated: true`

**Write blocked (read-only mode)**
- **Given** a connection with `allow_writes: false`
- **When** `db_query` is called with `sql: "DELETE FROM sessions WHERE expires_at < NOW()"`
- **Then** returns `PERMISSION_DENIED` and zero rows are deleted

**DDL always blocked**
- **Given** any connection regardless of `allow_writes` setting
- **When** `db_query` is called with `sql: "DROP TABLE users"`
- **Then** returns `PERMISSION_DENIED` and the table is NOT dropped

**Query timeout**
- **Given** a query that runs longer than `timeout_ms`
- **When** `db_query` is called
- **Then** returns `DEADLINE_EXCEEDED` and the query is cancelled at the driver level

**Credentials never leaked**
- **Given** a connection with `auth_method: "username_password"`
- **When** `testConnection` fails due to wrong password
- **Then** the error response contains no host, username, or password values

**Connection test**
- **Given** a running local MySQL on port 3306 with valid credentials stored
- **When** `POST /api/connections/:id/test` is called
- **Then** status becomes `"connected"`, `latency_ms` is a positive integer

**Agent: database-explorer**
- **Given** the `database-explorer` agent is enabled and a connected DB connection exists
- **When** an agent session starts
- **Then** the agent has access to `db_list_schemas`, `db_list_tables`, `db_describe_table`, and `db_query`
