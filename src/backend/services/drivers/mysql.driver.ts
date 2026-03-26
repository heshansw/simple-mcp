import mysql from "mysql2/promise";
import type { Pool, PoolOptions, RowDataPacket } from "mysql2/promise";
import { ok, err, integrationError } from "@shared/result.js";
import type { Result } from "@shared/result.js";
import type { DomainError } from "@shared/result.js";
import type {
  DatabaseDriver,
  QueryOptions,
  QueryResult,
  TableInfo,
  TableDescription,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
} from "./database-driver.interface.js";

export type MysqlDriverConfig = {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
};

export type MysqlDriverConfigFromString = {
  readonly connectionString: string;
};

function parseConnectionString(connStr: string): PoolOptions {
  const url = new URL(connStr);
  return {
    host: url.hostname,
    port: Number(url.port) || 3306,
    database: url.pathname.replace("/", ""),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

export function createMysqlDriver(
  config: MysqlDriverConfig | MysqlDriverConfigFromString
): DatabaseDriver {
  const poolOptions: PoolOptions =
    "connectionString" in config
      ? parseConnectionString(config.connectionString)
      : {
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          password: config.password,
        };

  const pool: Pool = mysql.createPool({
    ...poolOptions,
    connectionLimit: 5,
    idleTimeout: 30_000,
    enableKeepAlive: true,
  });

  return {
    dialect: "mysql",

    async query(
      sql: string,
      params: unknown[],
      options: QueryOptions
    ): Promise<Result<QueryResult, DomainError>> {
      const start = Date.now();
      let conn: mysql.PoolConnection | undefined;
      try {
        conn = await pool.getConnection();
        await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${options.timeoutMs}`);

        const cappedSql = `${sql} LIMIT ${options.maxRows + 1}`;
        const [rows] = await conn.query<RowDataPacket[]>(cappedSql, params);

        const truncated = rows.length > options.maxRows;
        const resultRows = truncated ? rows.slice(0, options.maxRows) : rows;
        const columns =
          resultRows.length > 0 ? Object.keys(resultRows[0] as Record<string, unknown>) : [];

        return ok({
          rows: resultRows as Record<string, unknown>[],
          columns,
          rowCount: resultRows.length,
          truncated,
          executionMs: Date.now() - start,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("max_execution_time") || msg.includes("Query execution was interrupted")) {
          return err(
            integrationError("mysql", "Query timed out", 504)
          );
        }
        return err(integrationError("mysql", msg));
      } finally {
        conn?.release();
      }
    },

    async listSchemas(): Promise<Result<string[], DomainError>> {
      try {
        const [rows] = await pool.query<RowDataPacket[]>("SHOW DATABASES");
        const schemas = (rows as Array<{ Database: string }>).map(
          (r) => r.Database
        );
        return ok(schemas);
      } catch (error) {
        return err(
          integrationError("mysql", error instanceof Error ? error.message : String(error))
        );
      }
    },

    async listTables(schema: string): Promise<Result<TableInfo[], DomainError>> {
      try {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, TABLE_ROWS AS row_count_estimate
           FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = ?
           ORDER BY TABLE_NAME`,
          [schema]
        );

        const tables: TableInfo[] = (
          rows as Array<{ name: string; type: string; row_count_estimate: number | null }>
        ).map((r) => ({
          name: r.name,
          type: r.type,
          rowCountEstimate: r.row_count_estimate ?? 0,
        }));

        return ok(tables);
      } catch (error) {
        return err(
          integrationError("mysql", error instanceof Error ? error.message : String(error))
        );
      }
    },

    async describeTable(
      schema: string,
      table: string
    ): Promise<Result<TableDescription, DomainError>> {
      try {
        // Columns
        const [colRows] = await pool.query<RowDataPacket[]>(
          `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY, EXTRA
           FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
           ORDER BY ORDINAL_POSITION`,
          [schema, table]
        );

        const columns: ColumnInfo[] = (
          colRows as Array<{
            COLUMN_NAME: string;
            COLUMN_TYPE: string;
            IS_NULLABLE: string;
            COLUMN_DEFAULT: string | null;
            COLUMN_KEY: string;
            EXTRA: string;
          }>
        ).map((r) => ({
          name: r.COLUMN_NAME,
          type: r.COLUMN_TYPE,
          nullable: r.IS_NULLABLE === "YES",
          defaultValue: r.COLUMN_DEFAULT,
          primaryKey: r.COLUMN_KEY === "PRI",
          autoIncrement: r.EXTRA.includes("auto_increment"),
        }));

        // Indexes
        const [idxRows] = await pool.query<RowDataPacket[]>(
          `SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
           FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
           GROUP BY INDEX_NAME, NON_UNIQUE`,
          [schema, table]
        );

        const indexes: IndexInfo[] = (
          idxRows as Array<{ INDEX_NAME: string; NON_UNIQUE: number; cols: string }>
        ).map((r) => ({
          name: r.INDEX_NAME,
          unique: r.NON_UNIQUE === 0,
          columns: r.cols.split(","),
        }));

        // Foreign keys
        const [fkRows] = await pool.query<RowDataPacket[]>(
          `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, DELETE_RULE
           FROM information_schema.KEY_COLUMN_USAGE kcu
           JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
             ON kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
             AND kcu.TABLE_SCHEMA = rc.CONSTRAINT_SCHEMA
           WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ?
             AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
          [schema, table]
        );

        const foreignKeys: ForeignKeyInfo[] = (
          fkRows as Array<{
            COLUMN_NAME: string;
            REFERENCED_TABLE_NAME: string;
            REFERENCED_COLUMN_NAME: string;
            DELETE_RULE: string;
          }>
        ).map((r) => ({
          column: r.COLUMN_NAME,
          referencesTable: r.REFERENCED_TABLE_NAME,
          referencesColumn: r.REFERENCED_COLUMN_NAME,
          onDelete: r.DELETE_RULE,
        }));

        return ok({ schema, table, columns, indexes, foreignKeys });
      } catch (error) {
        return err(
          integrationError("mysql", error instanceof Error ? error.message : String(error))
        );
      }
    },

    async testConnection(): Promise<Result<{ latencyMs: number }, DomainError>> {
      const start = Date.now();
      try {
        await pool.query("SELECT 1");
        return ok({ latencyMs: Date.now() - start });
      } catch (error) {
        return err(
          integrationError("mysql", "Connection failed")
        );
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
