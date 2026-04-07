import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTaskProgress } from "@frontend/api/agent-executions.api";
import type { TaskProgressRun, TaskItem, DelegatedRunItem } from "@frontend/api/agent-executions.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { RunStatusBadge } from "@frontend/components/run-status-badge";

const STATUS_FILTERS = ["all", "active", "completed"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  active: "Active",
  completed: "Completed",
};

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
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function isActive(status: string): boolean {
  return status === "planning" || status === "executing";
}

// ── Task status helpers ─────────────────────────────────────────────

const TASK_STATUS_COLORS: Record<string, { bg: string; fg: string; icon: string }> = {
  pending: { bg: "#f3f4f6", fg: "#6b7280", icon: "\u25cb" },
  in_progress: { bg: "#dbeafe", fg: "#1e40af", icon: "\u25d4" },
  completed: { bg: "#dcfce7", fg: "#166534", icon: "\u2713" },
  failed: { bg: "#fee2e2", fg: "#991b1b", icon: "\u2717" },
  skipped: { bg: "#f3f4f6", fg: "#9ca3af", icon: "\u2014" },
};

const DEFAULT_TASK_STATUS = { bg: "#f3f4f6", fg: "#6b7280", icon: "?" };

function TaskStatusIcon({ status }: { status: string }) {
  const style = TASK_STATUS_COLORS[status] ?? DEFAULT_TASK_STATUS;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "22px",
        height: "22px",
        borderRadius: "50%",
        backgroundColor: style.bg,
        color: style.fg,
        fontSize: "0.75rem",
        fontWeight: "700",
        flexShrink: 0,
      }}
    >
      {style.icon}
    </span>
  );
}

// ── Task progress bar ───────────────────────────────────────────────

function TaskProgressBar({ tasks }: { tasks: TaskItem[] }) {
  if (tasks.length === 0) return null;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const inProgress = tasks.filter((t) => t.status === "in_progress").length;
  const total = tasks.length;
  const completedPct = (completed / total) * 100;
  const failedPct = (failed / total) * 100;
  const inProgressPct = (inProgress / total) * 100;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <div
        style={{
          flex: 1,
          height: "8px",
          backgroundColor: "#e5e7eb",
          borderRadius: "4px",
          overflow: "hidden",
          display: "flex",
        }}
      >
        <div
          style={{
            width: `${completedPct}%`,
            backgroundColor: "#16a34a",
            transition: "width 0.3s",
          }}
        />
        <div
          style={{
            width: `${inProgressPct}%`,
            backgroundColor: "#3b82f6",
            transition: "width 0.3s",
          }}
        />
        <div
          style={{
            width: `${failedPct}%`,
            backgroundColor: "#ef4444",
            transition: "width 0.3s",
          }}
        />
      </div>
      <span style={{ fontSize: "0.75rem", color: "#6b7280", whiteSpace: "nowrap" }}>
        {completed}/{total}
      </span>
    </div>
  );
}

// ── Task list within a run card ────────────────────────────────────

function TaskChecklist({ tasks }: { tasks: TaskItem[] }) {
  if (tasks.length === 0) {
    return (
      <div style={{ padding: "0.5rem 0", color: "#9ca3af", fontSize: "0.8125rem", fontStyle: "italic" }}>
        No planned tasks (single-step execution)
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      {tasks.map((task, idx) => {
        const statusStyle = TASK_STATUS_COLORS[task.status] ?? DEFAULT_TASK_STATUS;
        return (
          <div
            key={task.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "0.5rem",
              padding: "0.375rem 0.5rem",
              borderRadius: "0.25rem",
              backgroundColor: task.status === "in_progress" ? "#eff6ff" : "transparent",
            }}
          >
            <TaskStatusIcon status={task.status} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "0.8125rem",
                  color: task.status === "completed" ? "#6b7280" : "#111827",
                  textDecoration: task.status === "completed" ? "line-through" : "none",
                  lineHeight: "1.4",
                }}
              >
                <span style={{ color: "#9ca3af", marginRight: "0.375rem", fontSize: "0.75rem" }}>
                  {idx + 1}.
                </span>
                {task.description}
              </div>
              {task.requiredTools && task.requiredTools !== "[]" && (
                <div style={{ fontSize: "0.6875rem", color: "#9ca3af", marginTop: "0.125rem" }}>
                  Tools: {safeParseArray(task.requiredTools).join(", ")}
                </div>
              )}
            </div>
            <span
              style={{
                fontSize: "0.6875rem",
                color: statusStyle.fg,
                backgroundColor: statusStyle.bg,
                padding: "0.125rem 0.375rem",
                borderRadius: "0.25rem",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {task.status.replace("_", " ")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Delegated runs section ─────────────────────────────────────────

function DelegatedRunsList({ runs }: { runs: DelegatedRunItem[] }) {
  if (runs.length === 0) return null;

  return (
    <div style={{ marginTop: "0.75rem" }}>
      <div
        style={{
          fontSize: "0.6875rem",
          fontWeight: "600",
          textTransform: "uppercase",
          color: "#6b7280",
          marginBottom: "0.375rem",
        }}
      >
        Delegated Runs ({runs.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
        {runs.map((run) => (
          <Link
            key={run.id}
            to="/agent-executions/$runId"
            params={{ runId: run.id }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.375rem 0.5rem",
              borderRadius: "0.25rem",
              backgroundColor: "#f9fafb",
              textDecoration: "none",
              color: "inherit",
              fontSize: "0.8125rem",
            }}
          >
            <RunStatusBadge status={run.status} />
            <span style={{ fontWeight: "500", minWidth: "100px" }}>{run.agentName}</span>
            <span
              style={{
                flex: 1,
                color: "#6b7280",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {run.goal.substring(0, 80)}
            </span>
            <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
              {formatDuration(run.startedAt, run.completedAt)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ── Run card ───────────────────────────────────────────────────────

type RunCardProps = {
  run: TaskProgressRun;
  defaultExpanded: boolean;
};

function RunCard({ run, defaultExpanded }: RunCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const active = isActive(run.status);

  return (
    <div
      style={{
        backgroundColor: "#fff",
        border: `1px solid ${active ? "#93c5fd" : "#e5e7eb"}`,
        borderRadius: "0.5rem",
        overflow: "hidden",
        ...(active ? { boxShadow: "0 0 0 1px #93c5fd" } : {}),
      }}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "1rem",
          backgroundColor: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span
          style={{
            fontSize: "0.75rem",
            color: "#6b7280",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s",
          }}
        >
          {"\u25b6"}
        </span>
        <RunStatusBadge status={run.status} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontWeight: "600", fontSize: "0.875rem", color: "#111827" }}>
              {run.agentName}
            </span>
            {active && (
              <span
                style={{
                  display: "inline-block",
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  backgroundColor: "#3b82f6",
                  animation: "pulse 1.5s ease-in-out infinite",
                }}
              />
            )}
          </div>
          <div
            style={{
              fontSize: "0.8125rem",
              color: "#6b7280",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: "0.125rem",
            }}
          >
            {run.goal}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.25rem", flexShrink: 0 }}>
          <span style={{ fontSize: "0.75rem", color: "#6b7280" }}>
            {formatRelativeTime(run.startedAt)}
          </span>
          <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
            {formatDuration(run.startedAt, run.completedAt)}
          </span>
        </div>
      </button>

      {/* Task progress bar (always visible) */}
      {run.tasks.length > 0 && (
        <div style={{ padding: "0 1rem 0.75rem 2.75rem" }}>
          <TaskProgressBar tasks={run.tasks} />
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid #f3f4f6",
            padding: "1rem",
          }}
        >
          {/* Metrics row */}
          <div
            style={{
              display: "flex",
              gap: "1.5rem",
              fontSize: "0.75rem",
              color: "#6b7280",
              marginBottom: "1rem",
              flexWrap: "wrap",
            }}
          >
            <span>Iterations: <strong>{run.iterationCount}</strong></span>
            <span>Tool Calls: <strong>{run.toolCallCount}</strong></span>
            <span>Tokens: <strong>{(run.inputTokensUsed + run.outputTokensUsed).toLocaleString()}</strong></span>
            {run.tasks.length > 0 && (
              <span>
                Tasks: <strong>{run.tasks.filter((t) => t.status === "completed").length}/{run.tasks.length}</strong>
              </span>
            )}
            {run.delegatedRuns.length > 0 && (
              <span>Delegations: <strong>{run.delegatedRuns.length}</strong></span>
            )}
          </div>

          {/* Error message */}
          {run.errorMessage && (
            <div
              style={{
                padding: "0.5rem 0.75rem",
                backgroundColor: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: "0.25rem",
                fontSize: "0.8125rem",
                color: "#991b1b",
                fontFamily: "monospace",
                marginBottom: "0.75rem",
                whiteSpace: "pre-wrap",
              }}
            >
              {run.errorMessage}
            </div>
          )}

          {/* Task checklist */}
          <div style={{ marginBottom: "0.5rem" }}>
            <div
              style={{
                fontSize: "0.6875rem",
                fontWeight: "600",
                textTransform: "uppercase",
                color: "#6b7280",
                marginBottom: "0.375rem",
              }}
            >
              Planned Tasks
            </div>
            <TaskChecklist tasks={run.tasks} />
          </div>

          {/* Delegated runs */}
          <DelegatedRunsList runs={run.delegatedRuns} />

          {/* Link to full detail */}
          <div style={{ marginTop: "0.75rem", paddingTop: "0.5rem", borderTop: "1px solid #f3f4f6" }}>
            <Link
              to="/agent-executions/$runId"
              params={{ runId: run.id }}
              style={{
                fontSize: "0.8125rem",
                color: "#3b82f6",
                textDecoration: "none",
              }}
            >
              View full execution details &rarr;
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function safeParseArray(jsonStr: string): string[] {
  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ── Main page ──────────────────────────────────────────────────────

export function TaskProgressPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const { data: runs, isLoading, error } = useTaskProgress(
    statusFilter === "all" ? undefined : { status: statusFilter }
  );

  const activeCount = runs?.filter((r) => isActive(r.status)).length ?? 0;
  const completedCount = runs?.filter((r) => r.status === "completed").length ?? 0;
  const failedCount = runs?.filter((r) => r.status === "failed").length ?? 0;
  const totalTasks = runs?.reduce((sum, r) => sum + r.tasks.length, 0) ?? 0;
  const completedTasks = runs?.reduce(
    (sum, r) => sum + r.tasks.filter((t) => t.status === "completed").length,
    0
  ) ?? 0;

  if (isLoading) {
    return <LoadingSpinner message="Loading task progress..." />;
  }

  if (error) {
    return <ErrorDisplay error={error} message="Failed to load task progress" />;
  }

  return (
    <div>
      <h1 style={{ margin: "0 0 1.5rem 0", fontSize: "1.5rem", fontWeight: "600" }}>
        Task Progress
      </h1>

      {/* Summary stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "0.75rem",
          marginBottom: "1.5rem",
        }}
      >
        <SummaryCard label="Total Runs" value={String(runs?.length ?? 0)} />
        <SummaryCard label="Active" value={String(activeCount)} {...(activeCount > 0 ? { color: "#3b82f6" } : {})} />
        <SummaryCard label="Completed" value={String(completedCount)} color="#16a34a" />
        <SummaryCard label="Failed" value={String(failedCount)} {...(failedCount > 0 ? { color: "#ef4444" } : {})} />
        <SummaryCard
          label="Tasks Done"
          value={totalTasks > 0 ? `${completedTasks}/${totalTasks}` : "0"}
          color="#6b7280"
        />
      </div>

      {/* Filter tabs */}
      <div
        style={{
          display: "flex",
          gap: "0.25rem",
          marginBottom: "1rem",
          backgroundColor: "#f3f4f6",
          borderRadius: "0.375rem",
          padding: "0.25rem",
          width: "fit-content",
        }}
      >
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter}
            onClick={() => setStatusFilter(filter)}
            style={{
              padding: "0.375rem 0.75rem",
              fontSize: "0.8125rem",
              fontWeight: statusFilter === filter ? "600" : "400",
              color: statusFilter === filter ? "#111827" : "#6b7280",
              backgroundColor: statusFilter === filter ? "#fff" : "transparent",
              border: "none",
              borderRadius: "0.25rem",
              cursor: "pointer",
              boxShadow: statusFilter === filter ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
            }}
          >
            {STATUS_LABELS[filter]}
          </button>
        ))}
      </div>

      {/* Run cards */}
      {runs && runs.length === 0 ? (
        <div
          style={{
            padding: "3rem 2rem",
            backgroundColor: "#fff",
            borderRadius: "0.5rem",
            border: "1px solid #e5e7eb",
            textAlign: "center",
            color: "#9ca3af",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>{"\ud83d\udcca"}</div>
          <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", fontWeight: "500" }}>
            No orchestration runs found
          </p>
          <p style={{ margin: "0", fontSize: "0.8125rem" }}>
            Execute an orchestrator agent to see task planning and progress here.
          </p>
          <Link
            to="/agent-executions"
            style={{
              display: "inline-block",
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              backgroundColor: "#3b82f6",
              color: "#fff",
              borderRadius: "0.375rem",
              textDecoration: "none",
              fontSize: "0.8125rem",
            }}
          >
            Go to Executions
          </Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {runs?.map((run, idx) => (
            <RunCard key={run.id} run={run} defaultExpanded={idx === 0 && isActive(run.status)} />
          ))}
        </div>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

// ── Summary card ────────────────────────────────────────────────────

type SummaryCardProps = {
  label: string;
  value: string;
  color?: string;
};

function SummaryCard({ label, value, color }: SummaryCardProps) {
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
      <div
        style={{
          fontSize: "0.6875rem",
          fontWeight: "500",
          textTransform: "uppercase",
          color: "#6b7280",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.25rem",
          fontWeight: "700",
          color: color ?? "#111827",
          marginTop: "0.25rem",
        }}
      >
        {value}
      </div>
    </div>
  );
}
