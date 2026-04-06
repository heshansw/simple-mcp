import type { AgentExecutionStats } from "@frontend/api/agent-executions.api";

type ExecutionStatsCardProps = {
  stats: AgentExecutionStats;
};

function formatDuration(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

type StatBoxProps = {
  label: string;
  value: string;
  color?: string;
};

function StatBox({ label, value, color }: StatBoxProps) {
  return (
    <div
      style={{
        padding: "0.75rem 1rem",
        backgroundColor: "#fff",
        borderRadius: "0.375rem",
        border: "1px solid #e5e7eb",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "0.6875rem", fontWeight: "500", textTransform: "uppercase", color: "#6b7280" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.25rem", fontWeight: "700", color: color ?? "#111827", marginTop: "0.25rem" }}>
        {value}
      </div>
    </div>
  );
}

export function ExecutionStatsCard({ stats }: ExecutionStatsCardProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: "0.75rem",
        marginBottom: "1.5rem",
      }}
    >
      <StatBox label="Total Runs" value={formatNumber(stats.totalRuns)} />
      <StatBox
        label="Active Runs"
        value={formatNumber(stats.activeRuns)}
        color={stats.activeRuns > 0 ? "#3b82f6" : "#111827"}
      />
      <StatBox
        label="Success Rate"
        value={`${stats.successRate}%`}
        color={stats.successRate >= 80 ? "#16a34a" : stats.successRate >= 50 ? "#f59e0b" : "#ef4444"}
      />
      <StatBox label="Total Tokens" value={formatNumber(stats.totalTokens)} />
      <StatBox label="Avg Duration" value={formatDuration(stats.avgDurationMs)} />
    </div>
  );
}
