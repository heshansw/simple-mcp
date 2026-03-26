import type { Result } from "@shared/result.js";
import type { DomainError } from "@shared/result.js";

export type QueryOptions = {
  readonly maxRows: number;
  readonly timeoutMs: number;
};

export type QueryResult = {
  readonly rows: Record<string, unknown>[];
  readonly columns: string[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly executionMs: number;
};

export type TableInfo = {
  readonly name: string;
  readonly type: string;
  readonly rowCountEstimate: number;
};

export type ColumnInfo = {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly defaultValue: string | null;
  readonly primaryKey: boolean;
  readonly autoIncrement: boolean;
};

export type IndexInfo = {
  readonly name: string;
  readonly unique: boolean;
  readonly columns: string[];
};

export type ForeignKeyInfo = {
  readonly column: string;
  readonly referencesTable: string;
  readonly referencesColumn: string;
  readonly onDelete: string;
};

export type TableDescription = {
  readonly schema: string;
  readonly table: string;
  readonly columns: ColumnInfo[];
  readonly indexes: IndexInfo[];
  readonly foreignKeys: ForeignKeyInfo[];
};

export interface DatabaseDriver {
  readonly dialect: "mysql" | "postgres";
  query(sql: string, params: unknown[], options: QueryOptions): Promise<Result<QueryResult, DomainError>>;
  listSchemas(): Promise<Result<string[], DomainError>>;
  listTables(schema: string): Promise<Result<TableInfo[], DomainError>>;
  describeTable(schema: string, table: string): Promise<Result<TableDescription, DomainError>>;
  testConnection(): Promise<Result<{ latencyMs: number }, DomainError>>;
  close(): Promise<void>;
}
