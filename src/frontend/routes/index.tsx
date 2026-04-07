import { useServerHealth } from "@frontend/api/health.api";
import { useConnections } from "@frontend/api/connections.api";
import { useAgents } from "@frontend/api/agents.api";
import {
  useAgentExecutions,
  useAgentExecutionStats,
} from "@frontend/api/agent-executions.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { ExecutionStatsCard } from "@frontend/components/execution-stats-card";
import { RunStatusBadge } from "@frontend/components/run-status-badge";
import { Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";

export function DashboardPage() {
  const { data: health, isLoading: healthLoading, error: healthError } =
    useServerHealth();
  const { data: connections, isLoading: connectionsLoading } = useConnections();
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const { data: stats } = useAgentExecutionStats();
  const { data: allRuns } = useAgentExecutions({ limit: 50 });
  const [enabledAgentsCount, setEnabledAgentsCount] = useState(0);

  useEffect(() => {
    if (agents) {
      setEnabledAgentsCount(agents.length);
    }
  }, [agents]);

  const activeRuns = (allRuns ?? []).filter(
    (r) => r.status === "planning" || r.status === "executing"
  );
  const recentCompletions = (allRuns ?? [])
    .filter((r) => r.status === "completed" || r.status === "failed" || r.status === "cancelled")
    .slice(0, 10);

  const agentNameMap = new Map(
    (agents ?? []).map((a) => [a.id, a.name])
  );

  if (healthLoading || connectionsLoading || agentsLoading) {
    return <LoadingSpinner message="Loading dashboard..." />;
  }

  if (healthError) {
    return (
      <ErrorDisplay error={healthError} message="Failed to load server health" />
    );
  }

  return (
    <div>
      <h1 style={{ marginTop: "0", marginBottom: "2rem" }}>Dashboard</h1>

      {/* Health Status Card */}
      {health && (
        <div
          style={{
            marginBottom: "2rem",
            padding: "1.5rem",
            backgroundColor: "#fff",
            borderRadius: "0.375rem",
            border: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ marginTop: "0", fontSize: "1.125rem" }}>
            Server Health
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1rem" }}>
            <div>
              <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>
                Status
              </p>
              <p
                style={{
                  margin: "0.5rem 0 0 0",
                  fontSize: "1.125rem",
                  fontWeight: "600",
                  color:
                    health.status === "healthy"
                      ? "#16a34a"
                      : health.status === "degraded"
                        ? "#f59e0b"
                        : "#dc2626",
                }}
              >
                {health.status.toUpperCase()}
              </p>
            </div>
            <div>
              <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>
                Uptime
              </p>
              <p style={{ margin: "0.5rem 0 0 0", fontSize: "1.125rem", fontWeight: "600" }}>
                {formatUptime(health.uptime)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Execution Stats Bar */}
      {stats && (
        <div style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ marginTop: "0", fontSize: "1.125rem", marginBottom: "0.75rem" }}>
            Execution Overview
          </h2>
          <ExecutionStatsCard stats={stats} />
        </div>
      )}

      {/* Quick Stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "1rem",
          marginBottom: "2rem",
        }}
      >
        <StatCard
          label="Active Connections"
          value={connections?.length ?? 0}
        />
        <StatCard
          label="Enabled Agents"
          value={enabledAgentsCount}
        />
        <StatCard
          label="Total Agents"
          value={agents?.length ?? 0}
        />
      </div>

      {/* Active Executions */}
      <div
        style={{
          padding: "1.5rem",
          backgroundColor: "#fff",
          borderRadius: "0.375rem",
          border: "1px solid #e5e7eb",
          marginBottom: "2rem",
        }}
      >
        <h2 style={{ marginTop: "0", fontSize: "1.125rem" }}>
          Active Executions
        </h2>
        {activeRuns.length === 0 ? (
          <p style={{ color: "#999", margin: "1rem 0 0 0" }}>
            No active executions.
          </p>
        ) : (
          <div style={{ marginTop: "0.75rem" }}>
            {activeRuns.map((run) => {
              const elapsed = Date.now() - new Date(run.startedAt).getTime();
              const maxIter = tryParseConfig(run.config)?.maxIterations ?? 25;
              const progress = maxIter > 0 ? Math.min(100, Math.round((run.iterationCount / maxIter) * 100)) : 0;

              return (
                <Link
                  key={run.id}
                  to="/agent-executions/$runId"
                  params={{ runId: run.id }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.75rem",
                    borderBottom: "1px solid #f3f4f6",
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <RunStatusBadge status={run.status} />
                  <span style={{ fontWeight: "500", fontSize: "0.875rem", minWidth: "120px" }}>
                    {agentNameMap.get(run.agentId) ?? run.agentId}
                  </span>
                  <span style={{ flex: 1, fontSize: "0.8125rem", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {run.goal.substring(0, 80)}
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                    {run.iterationCount} iter
                  </span>
                  <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                    {formatElapsed(elapsed)}
                  </span>
                  {/* Progress bar */}
                  <div
                    style={{
                      width: "60px",
                      height: "6px",
                      backgroundColor: "#e5e7eb",
                      borderRadius: "3px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${progress}%`,
                        height: "100%",
                        backgroundColor: "#3b82f6",
                        borderRadius: "3px",
                        transition: "width 0.3s",
                      }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Completions Feed */}
      <div
        style={{
          padding: "1.5rem",
          backgroundColor: "#fff",
          borderRadius: "0.375rem",
          border: "1px solid #e5e7eb",
          marginBottom: "2rem",
        }}
      >
        <h2 style={{ marginTop: "0", fontSize: "1.125rem" }}>
          Recent Completions
        </h2>
        {recentCompletions.length === 0 ? (
          <p style={{ color: "#999", margin: "1rem 0 0 0" }}>
            No completed executions yet.
          </p>
        ) : (
          <div style={{ marginTop: "0.75rem" }}>
            {recentCompletions.map((run) => (
              <Link
                key={run.id}
                to="/agent-executions/$runId"
                params={{ runId: run.id }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.5rem 0.75rem",
                  borderBottom: "1px solid #f3f4f6",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <RunStatusBadge status={run.status} />
                <span style={{ fontWeight: "500", fontSize: "0.875rem", minWidth: "120px" }}>
                  {agentNameMap.get(run.agentId) ?? run.agentId}
                </span>
                <span style={{ flex: 1, fontSize: "0.8125rem", color: "#6b7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {run.goal.substring(0, 80)}
                </span>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  {formatDuration(run.startedAt, run.completedAt)}
                </span>
                <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                  {(run.inputTokensUsed + run.outputTokensUsed).toLocaleString()} tok
                </span>
                <span style={{ fontSize: "0.6875rem", color: "#9ca3af" }}>
                  {formatRelativeTime(run.completedAt ?? run.startedAt)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Agent Performance Summary */}
      {stats && stats.agentUsage.length > 0 && (
        <div
          style={{
            padding: "1.5rem",
            backgroundColor: "#fff",
            borderRadius: "0.375rem",
            border: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ marginTop: "0", fontSize: "1.125rem" }}>
            Agent Performance Summary
          </h2>
          <div style={{ overflowX: "auto", marginTop: "0.75rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Agent", "Runs", "Success Rate", "Avg Duration", "Avg Tokens", "Last Run"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "0.5rem 0.75rem",
                        textAlign: "left",
                        backgroundColor: "#f9fafb",
                        fontWeight: "600",
                        fontSize: "0.6875rem",
                        textTransform: "uppercase",
                        color: "#6b7280",
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.agentUsage.map((a) => (
                  <tr key={a.agentId} style={{ borderBottom: "1px solid #e5e7eb" }}>
                    <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", fontWeight: "500" }}>
                      {a.agentName}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem" }}>{a.totalRuns}</td>
                    <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem" }}>
                      <span style={{ color: a.successRate >= 80 ? "#16a34a" : a.successRate >= 50 ? "#f59e0b" : "#ef4444" }}>
                        {a.successRate}%
                      </span>
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", color: "#6b7280" }}>
                      {formatDurationMs(a.avgDurationMs)}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.875rem", color: "#6b7280" }}>
                      {a.avgTokensPerRun.toLocaleString()}
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem", fontSize: "0.75rem", color: "#9ca3af" }}>
                      {formatRelativeTime(a.lastRunAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

type StatCardProps = {
  label: string;
  value: number;
};

function StatCard({ label, value }: StatCardProps) {
  return (
    <div
      style={{
        padding: "1.5rem",
        backgroundColor: "#fff",
        borderRadius: "0.375rem",
        border: "1px solid #e5e7eb",
      }}
    >
      <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>
        {label}
      </p>
      <p style={{ margin: "0.5rem 0 0 0", fontSize: "2rem", fontWeight: "700" }}>
        {value}
      </p>
    </div>
  );
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatDurationMs(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatRelativeTime(dateString: string): string {
  const now = Date.now();
  const date = new Date(dateString).getTime();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function tryParseConfig(configJson: string): { maxIterations?: number } | null {
  try {
    return JSON.parse(configJson) as { maxIterations?: number };
  } catch {
    return null;
  }
}
