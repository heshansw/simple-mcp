import { useServerHealth } from "@frontend/api/health.api";
import { useConnections } from "@frontend/api/connections.api";
import { useAgents } from "@frontend/api/agents.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { useState, useEffect } from "react";

export function DashboardPage() {
  const { data: health, isLoading: healthLoading, error: healthError } =
    useServerHealth();
  const { data: connections, isLoading: connectionsLoading } = useConnections();
  const { data: agents, isLoading: agentsLoading } = useAgents();
  const [enabledAgentsCount, setEnabledAgentsCount] = useState(0);

  useEffect(() => {
    if (agents) {
      // Note: In a real app, you'd fetch the config for each agent
      setEnabledAgentsCount(agents.length);
    }
  }, [agents]);

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

      {/* Recent Activity Placeholder */}
      <div
        style={{
          padding: "1.5rem",
          backgroundColor: "#fff",
          borderRadius: "0.375rem",
          border: "1px solid #e5e7eb",
        }}
      >
        <h2 style={{ marginTop: "0", fontSize: "1.125rem" }}>
          Recent Activity
        </h2>
        <p style={{ color: "#999", margin: "1rem 0 0 0" }}>
          No recent activity to display.
        </p>
      </div>
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

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}
