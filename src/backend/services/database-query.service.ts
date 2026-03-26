import type { Logger } from "pino";
import {
  type Result,
  ok,
  err,
  authorizationError,
  integrationError,
  validationError,
} from "@shared/result.js";
import type { DomainError } from "@shared/result.js";
import type {
  DatabaseDriver,
  QueryResult,
  TableInfo,
  TableDescription,
} from "./drivers/database-driver.interface.js";
import type { DbPermissions } from "@shared/schemas/database-connection.schema.js";
import { createMysqlDriver } from "./drivers/mysql.driver.js";
import { createPostgresDriver } from "./drivers/postgres.driver.js";
import type { DbCredentials } from "@shared/schemas/database-connection.schema.js";

// ── SQL statement classification ────────────────────────────────────

const DDL_KEYWORDS = ["CREATE", "DROP", "ALTER", "TRUNCATE", "RENAME"] as const;
const WRITE_KEYWORDS = ["INSERT", "UPDATE", "DELETE", "REPLACE", "MERGE"] as const;
const READ_KEYWORDS = ["SELECT", "WITH", "SHOW", "DESCRIBE", "EXPLAIN"] as const;

function classifySql(sql: string): {
  keyword: string;
  isDDL: boolean;
  isWrite: boolean;
  isRead: boolean;
} {
  const normalized = sql.trim().replace(/^\/\*.*?\*\/\s*/s, ""); // strip leading block comments
  const firstWord = normalized.split(/[\s(]/)[0]?.toUpperCase() ?? "";

  return {
    keyword: firstWord,
    isDDL: (DDL_KEYWORDS as readonly string[]).includes(firstWord),
    isWrite: (WRITE_KEYWORDS as readonly string[]).includes(firstWord),
    isRead: (READ_KEYWORDS as readonly string[]).includes(firstWord),
  };
}

// ── Token estimation ────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4; // conservative estimate

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

// ── Types ───────────────────────────────────────────────────────────

export type DatabaseConnectionEntry = {
  readonly id: string;
  readonly name: string;
  readonly dialect: "mysql" | "postgres";
  readonly status: string;
  readonly permissions: DbPermissions;
};

export type ResolvedConnection = DatabaseConnectionEntry & {
  readonly credentials: DbCredentials;
};

export interface DatabaseQueryServiceDeps {
  readonly logger: Logger;
  readonly resolveConnection: (
    connectionId: string
  ) => Promise<Result<ResolvedConnection, DomainError>>;
}

export interface DatabaseQueryService {
  listSchemas(connectionId: string): Promise<Result<{ dialect: string; schemas: string[] }, DomainError>>;
  listTables(
    connectionId: string,
    schemaName: string
  ): Promise<Result<{ schema: string; tables: TableInfo[] }, DomainError>>;
  describeTable(
    connectionId: string,
    schemaName: string,
    tableName: string
  ): Promise<Result<TableDescription, DomainError>>;
  query(
    connectionId: string,
    sql: string,
    params: unknown[],
    maxRows: number,
    timeoutMs: number
  ): Promise<Result<QueryResult, DomainError>>;
  testConnection(connectionId: string): Promise<Result<{ dialect: string; latencyMs: number }, DomainError>>;
  closeAll(): Promise<void>;
}

// ── Permission checks ───────────────────────────────────────────────

function isSchemaAllowed(permissions: DbPermissions, schemaName: string): boolean {
  if (permissions.allowedSchemas.length === 0) return false;
  return permissions.allowedSchemas.some(
    (rule) => rule.schemaName === schemaName || rule.schemaName === "*"
  );
}

function isTableAllowed(permissions: DbPermissions, schemaName: string, tableName: string): boolean {
  if (permissions.allowedSchemas.length === 0) return false;
  const rule = permissions.allowedSchemas.find(
    (r) => r.schemaName === schemaName || r.schemaName === "*"
  );
  if (!rule) return false;
  // Empty tables array = all tables allowed in that schema
  if (rule.tables.length === 0) return true;
  return rule.tables.includes(tableName);
}

function filterSchemas(permissions: DbPermissions, schemas: string[]): string[] {
  if (permissions.allowedSchemas.length === 0) return [];
  const hasWildcard = permissions.allowedSchemas.some((r) => r.schemaName === "*");
  if (hasWildcard) return schemas;
  const allowed = new Set(permissions.allowedSchemas.map((r) => r.schemaName));
  return schemas.filter((s) => allowed.has(s));
}

function filterTables(permissions: DbPermissions, schemaName: string, tables: TableInfo[]): TableInfo[] {
  const rule = permissions.allowedSchemas.find(
    (r) => r.schemaName === schemaName || r.schemaName === "*"
  );
  if (!rule) return [];
  if (rule.tables.length === 0) return tables; // all tables allowed
  const allowed = new Set(rule.tables);
  return tables.filter((t) => allowed.has(t.name));
}

// ── Service factory ─────────────────────────────────────────────────

export function createDatabaseQueryService(
  deps: DatabaseQueryServiceDeps
): DatabaseQueryService {
  const { logger } = deps;

  // Pool of active drivers keyed by connection id
  const drivers = new Map<string, DatabaseDriver>();

  async function getDriver(
    conn: ResolvedConnection
  ): Promise<DatabaseDriver> {
    const existing = drivers.get(conn.id);
    if (existing) return existing;

    const creds = conn.credentials;
    let driver: DatabaseDriver;

    if (conn.dialect === "mysql") {
      if (creds.method === "connection_string") {
        driver = createMysqlDriver({ connectionString: creds.connectionString });
      } else {
        driver = createMysqlDriver({
          host: creds.host,
          port: creds.port,
          database: creds.database,
          user: creds.username,
          password: creds.password,
        });
      }
    } else {
      if (creds.method === "connection_string") {
        driver = createPostgresDriver({ connectionString: creds.connectionString });
      } else {
        driver = createPostgresDriver({
          host: creds.host,
          port: creds.port,
          database: creds.database,
          user: creds.username,
          password: creds.password,
        });
      }
    }

    drivers.set(conn.id, driver);
    return driver;
  }

  async function resolve(
    connectionId: string
  ): Promise<Result<{ conn: ResolvedConnection; driver: DatabaseDriver }, DomainError>> {
    const connResult = await deps.resolveConnection(connectionId);
    if (connResult._tag === "Err") return connResult;
    const conn = connResult.value;

    if (conn.status !== "connected") {
      return err(
        integrationError(
          conn.dialect,
          'Connection is not active. Run POST /api/connections/:id/test to reconnect.',
          503
        )
      );
    }

    try {
      const driver = await getDriver(conn);
      return ok({ conn, driver });
    } catch (error) {
      return err(
        integrationError(conn.dialect, "Failed to initialize database driver")
      );
    }
  }

  return {
    async listSchemas(
      connectionId: string
    ): Promise<Result<{ dialect: string; schemas: string[] }, DomainError>> {
      const r = await resolve(connectionId);
      if (r._tag === "Err") return r;
      const { conn, driver } = r.value;

      const result = await driver.listSchemas();
      if (result._tag === "Err") return result;

      const filtered = filterSchemas(conn.permissions, result.value);
      return ok({ dialect: conn.dialect, schemas: filtered });
    },

    async listTables(
      connectionId: string,
      schemaName: string
    ): Promise<Result<{ schema: string; tables: TableInfo[] }, DomainError>> {
      const r = await resolve(connectionId);
      if (r._tag === "Err") return r;
      const { conn, driver } = r.value;

      if (!isSchemaAllowed(conn.permissions, schemaName)) {
        return err(
          authorizationError(
            `Access to schema '${schemaName}' is not permitted for this connection`,
            schemaName
          )
        );
      }

      const result = await driver.listTables(schemaName);
      if (result._tag === "Err") return result;

      const filtered = filterTables(conn.permissions, schemaName, result.value);
      return ok({ schema: schemaName, tables: filtered });
    },

    async describeTable(
      connectionId: string,
      schemaName: string,
      tableName: string
    ): Promise<Result<TableDescription, DomainError>> {
      const r = await resolve(connectionId);
      if (r._tag === "Err") return r;
      const { conn, driver } = r.value;

      if (!isTableAllowed(conn.permissions, schemaName, tableName)) {
        return err(
          authorizationError(
            `Access to table '${schemaName}.${tableName}' is not permitted`,
            `${schemaName}.${tableName}`
          )
        );
      }

      return driver.describeTable(schemaName, tableName);
    },

    async query(
      connectionId: string,
      sql: string,
      params: unknown[],
      maxRows: number,
      timeoutMs: number
    ): Promise<Result<QueryResult, DomainError>> {
      const r = await resolve(connectionId);
      if (r._tag === "Err") return r;
      const { conn, driver } = r.value;

      const classification = classifySql(sql);

      // DDL always blocked
      if (classification.isDDL) {
        return err(
          authorizationError(
            `DDL statements (${classification.keyword}) are never allowed`,
            classification.keyword
          )
        );
      }

      // Write guard
      if (classification.isWrite && !conn.permissions.allowWrites) {
        return err(
          authorizationError(
            `Write statements (${classification.keyword}) are not allowed. Connection is read-only.`,
            classification.keyword
          )
        );
      }

      // Must be a read statement if not a write
      if (!classification.isRead && !classification.isWrite) {
        return err(
          validationError(`Unsupported SQL statement type: ${classification.keyword}`)
        );
      }

      const cappedMaxRows = Math.min(maxRows, 1000);
      const cappedTimeout = Math.min(Math.max(timeoutMs, 500), 30_000);

      return driver.query(sql, params, {
        maxRows: cappedMaxRows,
        timeoutMs: cappedTimeout,
      });
    },

    async testConnection(
      connectionId: string
    ): Promise<Result<{ dialect: string; latencyMs: number }, DomainError>> {
      const connResult = await deps.resolveConnection(connectionId);
      if (connResult._tag === "Err") return connResult;
      const conn = connResult.value;

      // Close existing driver to force reconnect
      const existing = drivers.get(connectionId);
      if (existing) {
        await existing.close().catch(() => {});
        drivers.delete(connectionId);
      }

      try {
        const driver = await getDriver(conn);
        const result = await driver.testConnection();
        if (result._tag === "Err") return result;
        return ok({ dialect: conn.dialect, latencyMs: result.value.latencyMs });
      } catch {
        return err(integrationError(conn.dialect, "Connection test failed"));
      }
    },

    async closeAll(): Promise<void> {
      const closePromises = Array.from(drivers.values()).map((d) =>
        d.close().catch((e) => logger.error({ error: e }, "Error closing database driver"))
      );
      await Promise.all(closePromises);
      drivers.clear();
    },
  };
}
