import pg from "pg";
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

export type PostgresDriverConfig = {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
};

export type PostgresDriverConfigFromString = {
  readonly connectionString: string;
};

export function createPostgresDriver(
  config: PostgresDriverConfig | PostgresDriverConfigFromString
): DatabaseDriver {
  const poolConfig: pg.PoolConfig =
    "connectionString" in config
      ? { connectionString: config.connectionString }
      : {
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          password: config.password,
        };

  const pool = new pg.Pool({
    ...poolConfig,
    max: 5,
    idleTimeoutMillis: 30_000,
  });

  return {
    dialect: "postgres",

    async query(
      sql: string,
      params: unknown[],
      options: QueryOptions
    ): Promise<Result<QueryResult, DomainError>> {
      const start = Date.now();
      let client: pg.PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query(`SET statement_timeout = ${options.timeoutMs}`);

        // Only append LIMIT if the query doesn't already have one
        const hasLimit = /\bLIMIT\s+\d+/i.test(sql);
        const execSql = hasLimit ? sql : `${sql} LIMIT ${options.maxRows + 1}`;
        const result = await client.query(execSql, params);

        const allRows = result.rows as Record<string, unknown>[];
        const truncated = allRows.length > options.maxRows;
        const resultRows = truncated ? allRows.slice(0, options.maxRows) : allRows;
        const columns = result.fields.map((f) => f.name);

        return ok({
          rows: resultRows,
          columns,
          rowCount: resultRows.length,
          truncated,
          executionMs: Date.now() - start,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("statement timeout") || msg.includes("canceling statement")) {
          return err(integrationError("postgres", "Query timed out", 504));
        }
        return err(integrationError("postgres", msg));
      } finally {
        client?.release();
      }
    },

    async listSchemas(): Promise<Result<string[], DomainError>> {
      try {
        const result = await pool.query(
          `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`
        );
        const schemas = (result.rows as Array<{ schema_name: string }>).map(
          (r) => r.schema_name
        );
        return ok(schemas);
      } catch (error) {
        return err(
          integrationError("postgres", error instanceof Error ? error.message : String(error))
        );
      }
    },

    async listTables(schema: string): Promise<Result<TableInfo[], DomainError>> {
      try {
        const result = await pool.query(
          `SELECT
            t.table_name AS name,
            t.table_type AS type,
            COALESCE(s.n_live_tup, 0) AS row_count_estimate
          FROM information_schema.tables t
          LEFT JOIN pg_stat_user_tables s
            ON s.schemaname = t.table_schema AND s.relname = t.table_name
          WHERE t.table_schema = $1
          ORDER BY t.table_name`,
          [schema]
        );

        const tables: TableInfo[] = (
          result.rows as Array<{ name: string; type: string; row_count_estimate: string }>
        ).map((r) => ({
          name: r.name,
          type: r.type,
          rowCountEstimate: Number(r.row_count_estimate),
        }));

        return ok(tables);
      } catch (error) {
        return err(
          integrationError("postgres", error instanceof Error ? error.message : String(error))
        );
      }
    },

    async describeTable(
      schema: string,
      table: string
    ): Promise<Result<TableDescription, DomainError>> {
      try {
        // Columns
        const colResult = await pool.query(
          `SELECT
            c.column_name,
            c.data_type || COALESCE('(' || c.character_maximum_length || ')', '') AS column_type,
            c.is_nullable,
            c.column_default,
            CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key,
            CASE WHEN c.column_default LIKE 'nextval%' THEN true ELSE false END AS is_auto_increment
          FROM information_schema.columns c
          LEFT JOIN (
            SELECT ku.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage ku
              ON tc.constraint_name = ku.constraint_name AND tc.table_schema = ku.table_schema
            WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type = 'PRIMARY KEY'
          ) pk ON pk.column_name = c.column_name
          WHERE c.table_schema = $1 AND c.table_name = $2
          ORDER BY c.ordinal_position`,
          [schema, table]
        );

        const columns: ColumnInfo[] = (
          colResult.rows as Array<{
            column_name: string;
            column_type: string;
            is_nullable: string;
            column_default: string | null;
            is_primary_key: boolean;
            is_auto_increment: boolean;
          }>
        ).map((r) => ({
          name: r.column_name,
          type: r.column_type,
          nullable: r.is_nullable === "YES",
          defaultValue: r.column_default,
          primaryKey: r.is_primary_key,
          autoIncrement: r.is_auto_increment,
        }));

        // Indexes
        const idxResult = await pool.query(
          `SELECT
            i.relname AS index_name,
            ix.indisunique AS is_unique,
            array_agg(a.attname ORDER BY k.n) AS columns
          FROM pg_index ix
          JOIN pg_class t ON t.oid = ix.indrelid
          JOIN pg_class i ON i.oid = ix.indexrelid
          JOIN pg_namespace n ON n.oid = t.relnamespace
          JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, n) ON true
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
          WHERE n.nspname = $1 AND t.relname = $2
          GROUP BY i.relname, ix.indisunique`,
          [schema, table]
        );

        const indexes: IndexInfo[] = (
          idxResult.rows as Array<{ index_name: string; is_unique: boolean; columns: string[] }>
        ).map((r) => ({
          name: r.index_name,
          unique: r.is_unique,
          columns: r.columns,
        }));

        // Foreign keys
        const fkResult = await pool.query(
          `SELECT
            kcu.column_name,
            ccu.table_name AS references_table,
            ccu.column_name AS references_column,
            rc.delete_rule
          FROM information_schema.key_column_usage kcu
          JOIN information_schema.referential_constraints rc
            ON kcu.constraint_name = rc.constraint_name AND kcu.constraint_schema = rc.constraint_schema
          JOIN information_schema.constraint_column_usage ccu
            ON rc.unique_constraint_name = ccu.constraint_name AND rc.unique_constraint_schema = ccu.constraint_schema
          WHERE kcu.table_schema = $1 AND kcu.table_name = $2`,
          [schema, table]
        );

        const foreignKeys: ForeignKeyInfo[] = (
          fkResult.rows as Array<{
            column_name: string;
            references_table: string;
            references_column: string;
            delete_rule: string;
          }>
        ).map((r) => ({
          column: r.column_name,
          referencesTable: r.references_table,
          referencesColumn: r.references_column,
          onDelete: r.delete_rule,
        }));

        return ok({ schema, table, columns, indexes, foreignKeys });
      } catch (error) {
        return err(
          integrationError("postgres", error instanceof Error ? error.message : String(error))
        );
      }
    },

    async testConnection(): Promise<Result<{ latencyMs: number }, DomainError>> {
      const start = Date.now();
      try {
        await pool.query("SELECT 1");
        return ok({ latencyMs: Date.now() - start });
      } catch (error) {
        const rawMsg = error instanceof Error ? error.message : String(error);
        const safeMsg = rawMsg
          .replace(/password[=:]\s*\S+/gi, "password=***")
          .replace(/user[=:]\s*\S+/gi, "user=***");
        return err(integrationError("postgres", `Connection failed: ${safeMsg}`));
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
