import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useAgentExecutions, useAgentExecutionStats } from "@frontend/api/agent-executions.api";
import { useAgents } from "@frontend/api/agents.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { RunStatusBadge } from "@frontend/components/run-status-badge";
import { ExecuteAgentForm } from "@frontend/components/execute-agent-form";
import { ExecutionStatsCard } from "@frontend/components/execution-stats-card";
import type { AgentRunResult } from "@frontend/api/agent-executions.api";

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

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "Running...";
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  const diffMs = end - start;
  if (diffMs < 1000) return `${diffMs}ms`;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export function AgentExecutionsListPage() {
  const [showExecuteForm, setShowExecuteForm] = useState(false);
  const { data: runs, isLoading, error } = useAgentExecutions({ limit: 50 });
  const { data: agents } = useAgents();
  const { data: stats } = useAgentExecutionStats();
  const navigate = useNavigate();

  const agentNameMap = new Map(
    (agents ?? []).map((a) => [a.id, a.name])
  );

  const handleExecuted = (result: AgentRunResult) => {
    setShowExecuteForm(false);
    navigate({ to: "/agent-executions/$runId", params: { runId: result.runId } });
  };

  if (isLoading) {
    return <LoadingSpinner message="Loading agent executions..." />;
  }

  if (error) {
    return <ErrorDisplay error={error} message="Failed to load agent executions" />;
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1.5rem",
        }}
      >
        <h1 style={{ margin: "0", fontSize: "1.5rem", fontWeight: "600" }}>
          Agent Executions
        </h1>
        <button
          onClick={() => setShowExecuteForm(!showExecuteForm)}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: showExecuteForm ? "#6b7280" : "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            fontWeight: "500",
            cursor: "pointer",
          }}
        >
          {showExecuteForm ? "Close" : "Execute Agent"}
        </button>
      </div>

      {/* Execute Form */}
      {showExecuteForm && agents && (
        <ExecuteAgentForm
          agents={agents.map((a) => ({ id: a.id, name: a.name }))}
          onExecuted={handleExecuted}
          onCancel={() => setShowExecuteForm(false)}
        />
      )}

      {/* Stats Card */}
      {stats && <ExecutionStatsCard stats={stats} />}

      {/* Empty State */}
      {runs && runs.length === 0 ? (
        <div
          style={{
            padding: "2rem",
            backgroundColor: "#fff",
            borderRadius: "0.375rem",
            border: "1px solid #e5e7eb",
            textAlign: "center",
            color: "#999",
          }}
        >
          <p style={{ margin: "0" }}>
            No agent executions yet. Execute an agent to get started.
          </p>
        </div>
      ) : (
        /* Runs Table */
        <div
          style={{
            backgroundColor: "#fff",
            borderRadius: "0.375rem",
            border: "1px solid #e5e7eb",
            overflow: "hidden",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr>
                {["Status", "Agent", "Goal", "Iterations", "Tool Calls", "Tokens", "Duration", "Started"].map(
                  (header) => (
                    <th
                      key={header}
                      style={{
                        padding: "0.75rem 1rem",
                        textAlign: "left",
                        backgroundColor: "#f9fafb",
                        fontWeight: "600",
                        fontSize: "0.75rem",
                        textTransform: "uppercase",
                        color: "#6b7280",
                        borderBottom: "1px solid #e5e7eb",
                      }}
                    >
                      {header}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {runs?.map((run) => (
                <tr
                  key={run.id}
                  style={{ borderBottom: "1px solid #e5e7eb" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "#f9fafb";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "transparent";
                  }}
                >
                  <td style={{ padding: "0.75rem 1rem" }}>
                    <RunStatusBadge status={run.status} />
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem", fontWeight: "500" }}>
                    <Link
                      to="/agent-executions/$runId"
                      params={{ runId: run.id }}
                      style={{ color: "#3b82f6", textDecoration: "none" }}
                    >
                      {agentNameMap.get(run.agentId) ?? run.agentId}
                    </Link>
                  </td>
                  <td
                    style={{
                      padding: "0.75rem 1rem",
                      fontSize: "0.875rem",
                      color: "#374151",
                      maxWidth: "300px",
                    }}
                  >
                    {truncateText(run.goal, 80)}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem", color: "#6b7280" }}>
                    {run.iterationCount}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem", color: "#6b7280" }}>
                    {run.toolCallCount}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem", color: "#6b7280" }}>
                    {formatNumber(run.inputTokensUsed + run.outputTokensUsed)}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem", color: "#6b7280" }}>
                    {formatDuration(run.startedAt, run.completedAt)}
                  </td>
                  <td style={{ padding: "0.75rem 1rem", fontSize: "0.875rem", color: "#6b7280" }}>
                    {formatRelativeTime(run.startedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
