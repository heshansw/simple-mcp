import { useState } from "react";
import {
  useDatabaseConnectionsList,
  useCreateDatabaseConnection,
  useDeleteDatabaseConnection,
  useUpdateDatabasePermissions,
  useStoreDatabaseCredentials,
  useTestDatabaseConnection,
  useDatabaseInsightsStats,
  useDatabaseInsightsActivity,
} from "@frontend/api/database-connections.api";
import type {
  DatabaseConnectionEntry,
  DbPermissions,
  DbPermissionRule,
  DbCredentials,
  DbQueryActivityEntry,
  DbQueryInsightsStats,
} from "@frontend/api/database-connections.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import {
  DATABASE_CONNECTIONS_DESCRIPTION,
  DATABASE_PERMISSIONS_DESCRIPTION,
} from "@shared/mcp-client.js";

// ── Helpers ──────────────────────────────────────────────────────────

function parsePermissions(json: string): DbPermissions {
  try {
    const parsed = JSON.parse(json);
    return {
      allowedSchemas: Array.isArray(parsed.allowedSchemas) ? parsed.allowedSchemas : [],
      allowWrites: parsed.allowWrites === true,
    };
  } catch {
    return { allowedSchemas: [], allowWrites: false };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusColor(status: string): { bg: string; fg: string } {
  switch (status) {
    case "connected": return { bg: "#dcfce7", fg: "#166534" };
    case "error": return { bg: "#fee2e2", fg: "#991b1b" };
    case "disconnected": return { bg: "#fef9c3", fg: "#854d0e" };
    default: return { bg: "#f3f4f6", fg: "#374151" };
  }
}

const TOOL_LABELS: Record<string, string> = {
  db_list_schemas: "List Schemas",
  db_list_tables: "List Tables",
  db_describe_table: "Describe Table",
  db_query: "Query",
};

// ── Stat Card ────────────────────────────────────────────────────────

type StatCardProps = { label: string; value: string | number; color?: string; subtitle?: string };

function StatCard({ label, value, color = "#3b82f6", subtitle }: StatCardProps) {
  return (
    <div style={{
      padding: "1.25rem",
      backgroundColor: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "0.5rem",
      borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.25rem", color: "#111827" }}>
        {typeof value === "number" ? formatNumber(value) : value}
      </div>
      {subtitle && (
        <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.25rem" }}>{subtitle}</div>
      )}
    </div>
  );
}

// ── Permission Editor ────────────────────────────────────────────────

type PermissionEditorProps = {
  permissions: DbPermissions;
  onChange: (p: DbPermissions) => void;
};

function PermissionEditor({ permissions, onChange }: PermissionEditorProps) {
  const [newSchema, setNewSchema] = useState("");
  const [newTables, setNewTables] = useState("");

  function addSchemaRule() {
    if (!newSchema.trim()) return;
    const tables = newTables
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    const rule: DbPermissionRule = { schemaName: newSchema.trim(), tables };
    onChange({
      ...permissions,
      allowedSchemas: [...permissions.allowedSchemas, rule],
    });
    setNewSchema("");
    setNewTables("");
  }

  function removeSchemaRule(index: number) {
    const updated = permissions.allowedSchemas.filter((_, i) => i !== index);
    onChange({ ...permissions, allowedSchemas: updated });
  }

  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: "0.375rem", padding: "1rem", backgroundColor: "#f9fafb" }}>
      <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem", fontWeight: 600 }}>Schema & Table Permissions</h4>
      <p style={{ fontSize: "0.75rem", color: "#6b7280", margin: "0 0 0.75rem 0" }}>
        {DATABASE_PERMISSIONS_DESCRIPTION}
      </p>

      {permissions.allowedSchemas.length > 0 && (
        <div style={{ marginBottom: "0.75rem" }}>
          {permissions.allowedSchemas.map((rule, idx) => (
            <div key={idx} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "0.5rem 0.75rem", marginBottom: "0.25rem",
              backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.25rem",
            }}>
              <div>
                <code style={{ fontWeight: 600, fontSize: "0.8rem" }}>{rule.schemaName}</code>
                {rule.tables.length > 0 ? (
                  <span style={{ fontSize: "0.75rem", color: "#6b7280", marginLeft: "0.5rem" }}>
                    tables: {rule.tables.join(", ")}
                  </span>
                ) : (
                  <span style={{ fontSize: "0.75rem", color: "#16a34a", marginLeft: "0.5rem" }}>
                    all tables
                  </span>
                )}
              </div>
              <button
                onClick={() => removeSchemaRule(idx)}
                style={{
                  background: "none", border: "none", color: "#ef4444", cursor: "pointer",
                  fontSize: "0.875rem", fontWeight: 600,
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "end", flexWrap: "wrap" }}>
        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 500, display: "block", marginBottom: "0.25rem" }}>Schema Name</label>
          <input
            type="text"
            value={newSchema}
            onChange={(e) => setNewSchema(e.target.value)}
            placeholder="e.g. my_app_db or *"
            style={{ padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: "0.25rem", fontSize: "0.8rem", width: "180px" }}
          />
        </div>
        <div>
          <label style={{ fontSize: "0.75rem", fontWeight: 500, display: "block", marginBottom: "0.25rem" }}>
            Tables <span style={{ color: "#9ca3af" }}>(comma-separated, empty = all)</span>
          </label>
          <input
            type="text"
            value={newTables}
            onChange={(e) => setNewTables(e.target.value)}
            placeholder="e.g. users, orders"
            style={{ padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: "0.25rem", fontSize: "0.8rem", width: "250px" }}
          />
        </div>
        <button
          onClick={addSchemaRule}
          disabled={!newSchema.trim()}
          style={{
            padding: "0.5rem 1rem", backgroundColor: newSchema.trim() ? "#3b82f6" : "#d1d5db",
            color: "#fff", border: "none", borderRadius: "0.25rem", cursor: newSchema.trim() ? "pointer" : "default",
            fontSize: "0.8rem",
          }}
        >
          Add
        </button>
      </div>

      <div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          id="allow-writes"
          checked={permissions.allowWrites}
          onChange={(e) => onChange({ ...permissions, allowWrites: e.target.checked })}
        />
        <label htmlFor="allow-writes" style={{ fontSize: "0.8rem", fontWeight: 500 }}>
          Allow write operations (INSERT, UPDATE, DELETE)
        </label>
        <span style={{ fontSize: "0.7rem", color: "#ef4444", fontWeight: 600 }}>DDL is always blocked</span>
      </div>
    </div>
  );
}

// ── Connection Card ──────────────────────────────────────────────────

type ConnectionCardProps = {
  conn: DatabaseConnectionEntry;
  onDelete: (id: string) => void;
  onSavePermissions: (id: string, permissions: DbPermissions) => void;
  onSaveCredentials: (id: string, credentials: DbCredentials) => void;
  isDeleting: boolean;
};

function ConnectionCard({ conn, onDelete, onSavePermissions, onSaveCredentials, isDeleting }: ConnectionCardProps) {
  const [showCreds, setShowCreds] = useState(false);
  const [showPerms, setShowPerms] = useState(false);
  const [permissions, setPermissions] = useState<DbPermissions>(() => parsePermissions(conn.dbPermissions));
  const [credMethod, setCredMethod] = useState<"username_password" | "connection_string">("username_password");
  const [credForm, setCredForm] = useState({ host: "127.0.0.1", port: "3306", database: "", username: "", password: "", connectionString: "" });
  const [testMessage, setTestMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const testMutation = useTestDatabaseConnection();
  const { bg, fg } = statusColor(conn.status);
  const updatePerms = useUpdateDatabasePermissions();

  function handleTest() {
    setTestMessage(null);
    testMutation.mutate(conn.id, {
      onSuccess: (data) => {
        setTestMessage({ type: "success", text: `Connected (${data.dialect}, ${data.latency_ms}ms)` });
      },
      onError: (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        setTestMessage({ type: "error", text: msg });
      },
    });
  }

  return (
    <div style={{
      padding: "1.25rem", border: "1px solid #e5e7eb", borderRadius: "0.5rem", backgroundColor: "#fff",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.75rem" }}>
        <div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: "1.125rem" }}>{conn.name}</h3>
            <span style={{
              display: "inline-block", padding: "0.15rem 0.5rem", borderRadius: "9999px",
              fontSize: "0.7rem", fontWeight: 600, backgroundColor: conn.integrationType === "mysql" ? "#dbeafe" : "#ede9fe",
              color: conn.integrationType === "mysql" ? "#1e40af" : "#5b21b6",
            }}>
              {conn.integrationType.toUpperCase()}
            </span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "#6b7280", marginTop: "0.25rem" }}>
            Created {timeAgo(conn.createdAt)}
            {" | "}
            {permissions.allowWrites ? (
              <span style={{ color: "#ea580c", fontWeight: 600 }}>Read + Write</span>
            ) : (
              <span style={{ color: "#16a34a" }}>Read Only</span>
            )}
            {" | "}
            {permissions.allowedSchemas.length === 0 ? (
              <span style={{ color: "#ef4444", fontWeight: 600 }}>No schemas permitted</span>
            ) : (
              <span>{permissions.allowedSchemas.length} schema(s) permitted</span>
            )}
          </div>
        </div>
        <span style={{
          padding: "0.25rem 0.75rem", borderRadius: "9999px",
          fontSize: "0.75rem", fontWeight: 500, backgroundColor: bg, color: fg,
        }}>
          {conn.status}
        </span>
      </div>

      {/* Permission summary */}
      {permissions.allowedSchemas.length > 0 && (
        <div style={{ marginBottom: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {permissions.allowedSchemas.map((rule, idx) => (
            <span key={idx} style={{
              padding: "0.2rem 0.5rem", borderRadius: "0.25rem",
              fontSize: "0.7rem", backgroundColor: "#f3f4f6", border: "1px solid #e5e7eb",
            }}>
              <code>{rule.schemaName}</code>
              {rule.tables.length > 0 && (
                <span style={{ color: "#6b7280" }}> ({rule.tables.length} tables)</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Test result feedback */}
      {testMessage && (
        <div style={{
          marginBottom: "0.75rem", padding: "0.5rem 0.75rem", borderRadius: "0.25rem",
          fontSize: "0.8rem", fontWeight: 500,
          backgroundColor: testMessage.type === "success" ? "#dcfce7" : "#fef2f2",
          color: testMessage.type === "success" ? "#166534" : "#991b1b",
          border: `1px solid ${testMessage.type === "success" ? "#bbf7d0" : "#fecaca"}`,
        }}>
          {testMessage.type === "success" ? "Connected" : "Failed"}: {testMessage.text}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          onClick={handleTest}
          disabled={testMutation.isPending}
          style={{
            padding: "0.4rem 0.75rem", fontSize: "0.8rem", cursor: "pointer",
            backgroundColor: "#10b981", color: "#fff", border: "none", borderRadius: "0.25rem",
          }}
        >
          {testMutation.isPending ? "Testing..." : "Test Connection"}
        </button>
        <button
          onClick={() => setShowCreds((v) => !v)}
          style={{
            padding: "0.4rem 0.75rem", fontSize: "0.8rem", cursor: "pointer",
            backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "0.25rem",
          }}
        >
          {showCreds ? "Hide Credentials" : "Set Credentials"}
        </button>
        <button
          onClick={() => setShowPerms((v) => !v)}
          style={{
            padding: "0.4rem 0.75rem", fontSize: "0.8rem", cursor: "pointer",
            backgroundColor: "#8b5cf6", color: "#fff", border: "none", borderRadius: "0.25rem",
          }}
        >
          {showPerms ? "Hide Permissions" : "Edit Permissions"}
        </button>
        <button
          onClick={() => onDelete(conn.id)}
          disabled={isDeleting}
          style={{
            padding: "0.4rem 0.75rem", fontSize: "0.8rem", cursor: "pointer",
            backgroundColor: "#ef4444", color: "#fff", border: "none", borderRadius: "0.25rem",
          }}
        >
          {isDeleting ? "Deleting..." : "Delete"}
        </button>
      </div>

      {/* Credentials form */}
      {showCreds && (
        <div style={{ marginTop: "1rem", padding: "1rem", backgroundColor: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "0.375rem" }}>
          <div style={{ marginBottom: "0.5rem" }}>
            <label style={{ fontSize: "0.75rem", fontWeight: 500 }}>Auth Method: </label>
            <select
              value={credMethod}
              onChange={(e) => setCredMethod(e.target.value as "username_password" | "connection_string")}
              style={{ padding: "0.25rem", fontSize: "0.8rem", border: "1px solid #d1d5db", borderRadius: "0.25rem" }}
            >
              <option value="username_password">Username/Password</option>
              <option value="connection_string">Connection String</option>
            </select>
          </div>

          {credMethod === "username_password" ? (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              {[
                { label: "Host", key: "host" as const, placeholder: "127.0.0.1" },
                { label: "Port", key: "port" as const, placeholder: conn.integrationType === "mysql" ? "3306" : "5432" },
                { label: "Database", key: "database" as const, placeholder: "my_app_db" },
                { label: "Username", key: "username" as const, placeholder: "dev_user" },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label style={{ fontSize: "0.7rem", fontWeight: 500, display: "block" }}>{label}</label>
                  <input
                    type="text"
                    value={credForm[key]}
                    onChange={(e) => setCredForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={placeholder}
                    style={{ width: "100%", padding: "0.4rem", fontSize: "0.8rem", border: "1px solid #d1d5db", borderRadius: "0.25rem", boxSizing: "border-box" }}
                  />
                </div>
              ))}
              <div style={{ gridColumn: "1 / -1" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 500, display: "block" }}>Password</label>
                <input
                  type="password"
                  value={credForm.password}
                  onChange={(e) => setCredForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="********"
                  style={{ width: "100%", padding: "0.4rem", fontSize: "0.8rem", border: "1px solid #d1d5db", borderRadius: "0.25rem", boxSizing: "border-box" }}
                />
              </div>
            </div>
          ) : (
            <div>
              <label style={{ fontSize: "0.7rem", fontWeight: 500, display: "block" }}>Connection String</label>
              <input
                type="password"
                value={credForm.connectionString}
                onChange={(e) => setCredForm((prev) => ({ ...prev, connectionString: e.target.value }))}
                placeholder={conn.integrationType === "mysql" ? "mysql://user:pass@127.0.0.1:3306/db" : "postgresql://user:pass@127.0.0.1:5432/db"}
                style={{ width: "100%", padding: "0.4rem", fontSize: "0.8rem", border: "1px solid #d1d5db", borderRadius: "0.25rem", boxSizing: "border-box" }}
              />
            </div>
          )}

          <button
            onClick={() => {
              const creds: DbCredentials =
                credMethod === "username_password"
                  ? {
                      method: "username_password",
                      host: credForm.host,
                      port: Number(credForm.port),
                      database: credForm.database,
                      username: credForm.username,
                      password: credForm.password,
                    }
                  : {
                      method: "connection_string",
                      connectionString: credForm.connectionString,
                    };
              onSaveCredentials(conn.id, creds);
              setShowCreds(false);
            }}
            style={{
              marginTop: "0.75rem", padding: "0.5rem 1rem", fontSize: "0.8rem",
              backgroundColor: "#3b82f6", color: "#fff", border: "none", borderRadius: "0.25rem", cursor: "pointer",
            }}
          >
            Save Credentials
          </button>
        </div>
      )}

      {/* Permissions editor */}
      {showPerms && (
        <div style={{ marginTop: "1rem" }}>
          <PermissionEditor permissions={permissions} onChange={setPermissions} />
          <button
            onClick={() => {
              onSavePermissions(conn.id, permissions);
            }}
            disabled={updatePerms.isPending}
            style={{
              marginTop: "0.5rem", padding: "0.5rem 1rem", fontSize: "0.8rem",
              backgroundColor: "#8b5cf6", color: "#fff", border: "none", borderRadius: "0.25rem", cursor: "pointer",
            }}
          >
            {updatePerms.isPending ? "Saving..." : "Save Permissions"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Add Connection Form ──────────────────────────────────────────────

function AddConnectionForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [dialect, setDialect] = useState<"mysql" | "postgres">("mysql");
  const createMutation = useCreateDatabaseConnection();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate(
      { name: name.trim(), dialect, authMethod: "username_password" },
      { onSuccess: () => { setName(""); onCreated(); } }
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{
      display: "flex", gap: "0.5rem", alignItems: "end", flexWrap: "wrap",
      padding: "1rem", backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem",
    }}>
      <div>
        <label style={{ fontSize: "0.75rem", fontWeight: 500, display: "block", marginBottom: "0.25rem" }}>Connection Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. local-mysql-dev"
          required
          style={{ padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: "0.25rem", fontSize: "0.8rem", width: "220px" }}
        />
      </div>
      <div>
        <label style={{ fontSize: "0.75rem", fontWeight: 500, display: "block", marginBottom: "0.25rem" }}>Dialect</label>
        <select
          value={dialect}
          onChange={(e) => setDialect(e.target.value as "mysql" | "postgres")}
          style={{ padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: "0.25rem", fontSize: "0.8rem" }}
        >
          <option value="mysql">MySQL</option>
          <option value="postgres">PostgreSQL</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={createMutation.isPending || !name.trim()}
        style={{
          padding: "0.5rem 1.25rem", backgroundColor: "#3b82f6", color: "#fff",
          border: "none", borderRadius: "0.25rem", cursor: "pointer", fontSize: "0.8rem",
        }}
      >
        {createMutation.isPending ? "Creating..." : "Add Connection"}
      </button>
    </form>
  );
}

// ── Insights Section ─────────────────────────────────────────────────

function InsightsSection() {
  const statsQuery = useDatabaseInsightsStats();
  const activityQuery = useDatabaseInsightsActivity();

  if (statsQuery.isLoading) return <LoadingSpinner />;
  if (statsQuery.isError) return <ErrorDisplay error={statsQuery.error} />;

  const stats = statsQuery.data as DbQueryInsightsStats | undefined;
  const activity = activityQuery.data as DbQueryActivityEntry[] | undefined;

  if (!stats) return null;

  return (
    <div>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: "0 0 1rem 0" }}>
        Token Usage & Insights
      </h2>

      {/* Stats grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <StatCard label="Total Queries" value={stats.totalCalls} color="#3b82f6" />
        <StatCard label="Success Rate" value={stats.totalCalls > 0 ? `${Math.round((stats.successfulCalls / stats.totalCalls) * 100)}%` : "N/A"} color="#10b981" />
        <StatCard label="Total Input Tokens" value={formatNumber(stats.totalInputTokens)} color="#f59e0b" subtitle="Estimated from query input" />
        <StatCard label="Total Output Tokens" value={formatNumber(stats.totalOutputTokens)} color="#8b5cf6" subtitle="Estimated from result size" />
        <StatCard label="Total Tokens" value={formatNumber(stats.totalTokens)} color="#ef4444" subtitle={`~${formatNumber(stats.avgTokensPerCall)} avg per call`} />
        <StatCard label="Total Data Retrieved" value={formatBytes(stats.totalResultBytes)} color="#06b6d4" />
        <StatCard label="Avg Duration" value={`${stats.avgDurationMs}ms`} color="#84cc16" />
        <StatCard label="Total Rows" value={formatNumber(stats.totalRowsReturned)} color="#ec4899" />
      </div>

      {/* Token breakdown by tool */}
      {Object.keys(stats.tokensByTool).length > 0 && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.5rem 0" }}>Tokens by Tool</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.5rem" }}>
            {Object.entries(stats.tokensByTool).map(([tool, tokens]) => (
              <div key={tool} style={{
                padding: "0.75rem", backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.375rem",
              }}>
                <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>{TOOL_LABELS[tool] ?? tool}</div>
                <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: "0.25rem" }}>
                  Input: {formatNumber(tokens.input)} | Output: {formatNumber(tokens.output)}
                </div>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#111827", marginTop: "0.25rem" }}>
                  Total: {formatNumber(tokens.input + tokens.output)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dialect breakdown */}
      {Object.keys(stats.callsByDialect).length > 0 && (
        <div style={{ marginBottom: "1.5rem", display: "flex", gap: "1rem" }}>
          {Object.entries(stats.callsByDialect).map(([dialect, count]) => (
            <div key={dialect} style={{
              padding: "0.5rem 1rem", backgroundColor: dialect === "mysql" ? "#dbeafe" : "#ede9fe",
              borderRadius: "0.375rem", fontSize: "0.8rem", fontWeight: 600,
              color: dialect === "mysql" ? "#1e40af" : "#5b21b6",
            }}>
              {dialect.toUpperCase()}: {count} queries
            </div>
          ))}
        </div>
      )}

      {/* Top schemas and tables */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
        {stats.topSchemas.length > 0 && (
          <div style={{ padding: "1rem", backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem" }}>
            <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem" }}>Top Schemas</h4>
            {stats.topSchemas.map((s) => (
              <div key={s.schema} style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.8rem" }}>
                <code>{s.schema}</code>
                <span style={{ color: "#6b7280" }}>{s.count} calls</span>
              </div>
            ))}
          </div>
        )}
        {stats.topTables.length > 0 && (
          <div style={{ padding: "1rem", backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem" }}>
            <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem" }}>Top Tables</h4>
            {stats.topTables.map((t) => (
              <div key={t.table} style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", fontSize: "0.8rem" }}>
                <code>{t.table}</code>
                <span style={{ color: "#6b7280" }}>{t.count} calls</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      {activity && activity.length > 0 && (
        <div>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.5rem 0" }}>Recent Activity</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
                  <th style={{ padding: "0.5rem" }}>Tool</th>
                  <th style={{ padding: "0.5rem" }}>Dialect</th>
                  <th style={{ padding: "0.5rem" }}>Schema</th>
                  <th style={{ padding: "0.5rem" }}>Rows</th>
                  <th style={{ padding: "0.5rem" }}>Tokens (In/Out)</th>
                  <th style={{ padding: "0.5rem" }}>Duration</th>
                  <th style={{ padding: "0.5rem" }}>Status</th>
                  <th style={{ padding: "0.5rem" }}>When</th>
                </tr>
              </thead>
              <tbody>
                {activity.slice(0, 25).map((a) => (
                  <tr key={a.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "0.5rem" }}>{TOOL_LABELS[a.toolName] ?? a.toolName}</td>
                    <td style={{ padding: "0.5rem" }}>
                      <span style={{
                        padding: "0.1rem 0.4rem", borderRadius: "0.25rem", fontSize: "0.7rem",
                        backgroundColor: a.dialect === "mysql" ? "#dbeafe" : "#ede9fe",
                        color: a.dialect === "mysql" ? "#1e40af" : "#5b21b6",
                      }}>
                        {a.dialect}
                      </span>
                    </td>
                    <td style={{ padding: "0.5rem" }}>{a.schemaName ?? "-"}</td>
                    <td style={{ padding: "0.5rem" }}>{a.rowCount}</td>
                    <td style={{ padding: "0.5rem" }}>
                      <span style={{ color: "#f59e0b" }}>{formatNumber(a.inputTokensEstimate)}</span>
                      {" / "}
                      <span style={{ color: "#8b5cf6" }}>{formatNumber(a.outputTokensEstimate)}</span>
                    </td>
                    <td style={{ padding: "0.5rem" }}>{a.durationMs}ms</td>
                    <td style={{ padding: "0.5rem" }}>
                      {a.success === 1 ? (
                        <span style={{ color: "#16a34a" }}>OK</span>
                      ) : (
                        <span style={{ color: "#ef4444" }}>{a.errorTag ?? "Error"}</span>
                      )}
                    </td>
                    <td style={{ padding: "0.5rem", color: "#6b7280" }}>{timeAgo(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Errors */}
      {stats.recentErrors.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h3 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.5rem 0", color: "#ef4444" }}>Recent Errors</h3>
          {stats.recentErrors.map((e, idx) => (
            <div key={idx} style={{
              padding: "0.5rem 0.75rem", marginBottom: "0.25rem",
              backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "0.25rem",
              fontSize: "0.8rem",
            }}>
              <span style={{ fontWeight: 600 }}>{TOOL_LABELS[e.toolName] ?? e.toolName}</span>
              {" — "}
              <span style={{ color: "#991b1b" }}>{e.errorTag}</span>
              <span style={{ color: "#6b7280", marginLeft: "0.5rem" }}>{timeAgo(e.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────

export function DatabasesPage() {
  const connectionsQuery = useDatabaseConnectionsList();
  const deleteMutation = useDeleteDatabaseConnection();
  const updatePermsMutation = useUpdateDatabasePermissions();
  const storeCredsMutation = useStoreDatabaseCredentials();

  const [activeTab, setActiveTab] = useState<"connections" | "insights">("connections");

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.5rem 0" }}>
        Local Databases
      </h1>
      <p style={{ color: "#6b7280", margin: "0 0 1.5rem 0", fontSize: "0.875rem" }}>
        {DATABASE_CONNECTIONS_DESCRIPTION}
        Permissions strictly control which schemas and tables are accessible.
      </p>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1.5rem", borderBottom: "2px solid #e5e7eb" }}>
        {(["connections", "insights"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "0.75rem 1.5rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              border: "none",
              borderBottom: activeTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
              backgroundColor: "transparent",
              color: activeTab === tab ? "#3b82f6" : "#6b7280",
              cursor: "pointer",
              marginBottom: "-2px",
            }}
          >
            {tab === "connections" ? "Connections" : "Token Insights"}
          </button>
        ))}
      </div>

      {activeTab === "connections" && (
        <div>
          {/* Add form */}
          <div style={{ marginBottom: "1.5rem" }}>
            <h2 style={{ fontSize: "1rem", fontWeight: 600, margin: "0 0 0.5rem 0" }}>Add Database Connection</h2>
            <AddConnectionForm onCreated={() => {}} />
          </div>

          {/* Connection list */}
          {connectionsQuery.isLoading && <LoadingSpinner />}
          {connectionsQuery.isError && <ErrorDisplay error={connectionsQuery.error} />}
          {connectionsQuery.data && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {connectionsQuery.data.length === 0 && (
                <p style={{ color: "#6b7280", fontSize: "0.875rem", textAlign: "center", padding: "2rem" }}>
                  No database connections registered. Add one above to get started.
                </p>
              )}
              {connectionsQuery.data.map((conn) => (
                <ConnectionCard
                  key={conn.id}
                  conn={conn}
                  onDelete={(id) => {
                    if (window.confirm(`Delete connection "${conn.name}"?`)) {
                      deleteMutation.mutate(id);
                    }
                  }}
                  onSavePermissions={(id, permissions) => updatePermsMutation.mutate({ id, permissions })}
                  onSaveCredentials={(id, credentials) => storeCredsMutation.mutate({ id, credentials })}
                  isDeleting={deleteMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "insights" && <InsightsSection />}
    </div>
  );
}
