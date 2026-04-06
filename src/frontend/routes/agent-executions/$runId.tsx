import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import {
  useAgentExecution,
  useCancelAgentRun,
  useAgentRunSteps,
  useDelegationTree,
} from "@frontend/api/agent-executions.api";
import { useAgents } from "@frontend/api/agents.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { RunStatusBadge } from "@frontend/components/run-status-badge";
import { StepTimeline } from "@frontend/components/step-timeline";
import { ToolCallLog } from "@frontend/components/tool-call-log";
import { DelegationTree } from "@frontend/components/delegation-tree";
import { TokenUsageChart } from "@frontend/components/token-usage-chart";

function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleString();
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
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

function isActiveState(state: string): boolean {
  return state === "planning" || state === "executing";
}

type StatCardProps = {
  label: string;
  value: string;
};

function StatCard({ label, value }: StatCardProps) {
  return (
    <div
      style={{
        backgroundColor: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "0.375rem",
        padding: "1rem",
      }}
    >
      <div
        style={{
          fontSize: "0.75rem",
          fontWeight: "500",
          textTransform: "uppercase",
          color: "#6b7280",
          marginBottom: "0.25rem",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: "600", color: "#111827" }}>
        {value}
      </div>
    </div>
  );
}

const TAB_IDS = ["steps", "tools", "delegation", "tokens"] as const;
type TabId = (typeof TAB_IDS)[number];

const TAB_LABELS: Record<TabId, string> = {
  steps: "Steps",
  tools: "Tool Calls",
  delegation: "Delegation",
  tokens: "Token Usage",
};

export function AgentExecutionDetailPage() {
  const { runId } = useParams({ strict: false }) as { runId: string };
  const { data: run, isLoading, error } = useAgentExecution(runId);
  const { data: agents } = useAgents();
  const cancelRun = useCancelAgentRun();
  const [activeTab, setActiveTab] = useState<TabId>("steps");

  const active = run ? isActiveState(run.state) : false;

  const { data: stepsData } = useAgentRunSteps(runId, {
    enabled: true,
    refetchInterval: active ? 3000 : false,
  });

  const { data: delegationTree } = useDelegationTree(runId, {
    enabled: activeTab === "delegation",
  });

  const agentName = agents?.find((a) => a.id === run?.agentId)?.name ?? run?.agentId ?? "Unknown";

  const handleCancel = async () => {
    if (!run) return;
    await cancelRun.mutateAsync(run.runId);
  };

  // Determine if delegation tab should be visible
  const hasDelegation = stepsData?.steps.some((s) => s.stepType === "delegation") ?? false;

  if (isLoading) {
    return <LoadingSpinner message="Loading execution details..." />;
  }

  if (error) {
    return <ErrorDisplay error={error} message="Failed to load execution details" />;
  }

  if (!run) {
    return <ErrorDisplay error={new Error("Run not found")} message="Execution not found" />;
  }

  // Try to parse the result JSON
  type ParsedRunResult = {
    answer?: string;
    tasksCompleted?: number;
    toolCallsMade?: number;
    durationMs?: number;
  };
  let parsedResult: ParsedRunResult | null = null;
  if (run.result) {
    try {
      parsedResult = JSON.parse(run.result) as ParsedRunResult;
    } catch {
      // result is not JSON, display as-is
    }
  }

  return (
    <div>
      {/* Back Link */}
      <Link
        to="/agent-executions"
        style={{
          color: "#3b82f6",
          textDecoration: "none",
          fontSize: "0.875rem",
          display: "inline-block",
          marginBottom: "1rem",
        }}
      >
        &larr; Back to Executions
      </Link>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <h1 style={{ margin: "0", fontSize: "1.5rem", fontWeight: "600" }}>
          {agentName}
        </h1>
        <RunStatusBadge status={run.state} />
        {active && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              fontSize: "0.75rem",
              color: "#6b7280",
            }}
          >
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
            Auto-refreshing...
          </span>
        )}
        <div style={{ flex: 1 }} />
        {active && (
          <button
            onClick={handleCancel}
            disabled={cancelRun.isPending}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: cancelRun.isPending ? "#fca5a5" : "#ef4444",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: "500",
              cursor: cancelRun.isPending ? "not-allowed" : "pointer",
            }}
          >
            {cancelRun.isPending ? "Cancelling..." : "Cancel Run"}
          </button>
        )}
      </div>

      {cancelRun.error && (
        <div style={{ marginBottom: "1rem" }}>
          <ErrorDisplay error={cancelRun.error} message="Failed to cancel run" />
        </div>
      )}

      {/* Goal */}
      <div
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "0.375rem",
          padding: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            fontSize: "0.75rem",
            fontWeight: "500",
            textTransform: "uppercase",
            color: "#6b7280",
            marginBottom: "0.5rem",
          }}
        >
          Goal
        </div>
        <div style={{ fontSize: "0.875rem", color: "#111827", whiteSpace: "pre-wrap" }}>
          {run.goal}
        </div>
      </div>

      {/* Metrics Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <StatCard label="Iterations" value={String(run.iterationCount)} />
        <StatCard label="Tool Calls" value={String(run.toolCallCount)} />
        <StatCard label="Input Tokens" value={formatNumber(run.inputTokensUsed)} />
        <StatCard label="Output Tokens" value={formatNumber(run.outputTokensUsed)} />
      </div>

      {/* Timing */}
      <div
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "0.375rem",
          padding: "1rem",
          marginBottom: "1.5rem",
        }}
      >
        <div
          style={{
            fontSize: "0.75rem",
            fontWeight: "500",
            textTransform: "uppercase",
            color: "#6b7280",
            marginBottom: "0.75rem",
          }}
        >
          Timing
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: "1rem",
          }}
        >
          <div>
            <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginBottom: "0.25rem" }}>
              Started
            </div>
            <div style={{ fontSize: "0.875rem", color: "#111827" }}>
              {formatDateTime(run.startedAt)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginBottom: "0.25rem" }}>
              Completed
            </div>
            <div style={{ fontSize: "0.875rem", color: "#111827" }}>
              {run.completedAt ? formatDateTime(run.completedAt) : "In progress..."}
            </div>
          </div>
          <div>
            <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginBottom: "0.25rem" }}>
              Duration
            </div>
            <div style={{ fontSize: "0.875rem", color: "#111827" }}>
              {formatDuration(run.startedAt, run.completedAt)}
            </div>
          </div>
        </div>
      </div>

      {/* Result */}
      {run.result && (
        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #dcfce7",
            borderRadius: "0.375rem",
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: "500",
              textTransform: "uppercase",
              color: "#166534",
              marginBottom: "0.75rem",
            }}
          >
            Result
          </div>
          <div
            style={{
              fontSize: "0.875rem",
              color: "#111827",
              whiteSpace: "pre-wrap",
              lineHeight: "1.5",
            }}
          >
            {parsedResult?.answer ?? run.result}
          </div>
          {parsedResult && (
            <div
              style={{
                marginTop: "1rem",
                paddingTop: "0.75rem",
                borderTop: "1px solid #e5e7eb",
                display: "flex",
                gap: "1.5rem",
                fontSize: "0.75rem",
                color: "#6b7280",
              }}
            >
              {parsedResult.tasksCompleted !== undefined && (
                <span>Tasks Completed: {parsedResult.tasksCompleted}</span>
              )}
              {parsedResult.toolCallsMade !== undefined && (
                <span>Tool Calls Made: {parsedResult.toolCallsMade}</span>
              )}
              {parsedResult.durationMs !== undefined && (
                <span>Duration: {(parsedResult.durationMs / 1000).toFixed(1)}s</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {run.errorMessage && (
        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #fee2e2",
            borderRadius: "0.375rem",
            padding: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: "500",
              textTransform: "uppercase",
              color: "#991b1b",
              marginBottom: "0.5rem",
            }}
          >
            Error
          </div>
          <div
            style={{
              fontSize: "0.875rem",
              color: "#991b1b",
              whiteSpace: "pre-wrap",
              fontFamily: "monospace",
            }}
          >
            {run.errorMessage}
          </div>
        </div>
      )}

      {/* Tabbed Step Views */}
      <div
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "0.375rem",
          marginBottom: "1.5rem",
          overflow: "hidden",
        }}
      >
        {/* Tab Bar */}
        <div
          style={{
            display: "flex",
            borderBottom: "1px solid #e5e7eb",
            backgroundColor: "#f9fafb",
          }}
        >
          {TAB_IDS.filter((id) => id !== "delegation" || hasDelegation).map((tabId) => (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId)}
              style={{
                padding: "0.75rem 1.25rem",
                fontSize: "0.8125rem",
                fontWeight: activeTab === tabId ? "600" : "400",
                color: activeTab === tabId ? "#3b82f6" : "#6b7280",
                backgroundColor: "transparent",
                border: "none",
                borderBottom: activeTab === tabId ? "2px solid #3b82f6" : "2px solid transparent",
                cursor: "pointer",
                marginBottom: "-1px",
              }}
            >
              {TAB_LABELS[tabId]}
              {tabId === "steps" && stepsData && (
                <span style={{ marginLeft: "0.375rem", fontSize: "0.6875rem", color: "#9ca3af" }}>
                  ({stepsData.total})
                </span>
              )}
              {tabId === "tools" && stepsData && (
                <span style={{ marginLeft: "0.375rem", fontSize: "0.6875rem", color: "#9ca3af" }}>
                  ({stepsData.steps.filter((s) => s.stepType === "tool_call").length})
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div style={{ padding: "1rem" }}>
          {activeTab === "steps" && stepsData && (
            <StepTimeline steps={stepsData.steps} total={stepsData.total} />
          )}
          {activeTab === "steps" && !stepsData && (
            <LoadingSpinner message="Loading steps..." />
          )}

          {activeTab === "tools" && stepsData && (
            <ToolCallLog steps={stepsData.steps} />
          )}

          {activeTab === "delegation" && delegationTree && (
            <DelegationTree tree={delegationTree} />
          )}
          {activeTab === "delegation" && !delegationTree && (
            <LoadingSpinner message="Loading delegation tree..." />
          )}

          {activeTab === "tokens" && stepsData && (
            <TokenUsageChart steps={stepsData.steps} />
          )}
        </div>
      </div>

      {/* Run ID */}
      <div
        style={{
          fontSize: "0.75rem",
          color: "#9ca3af",
          marginTop: "1rem",
        }}
      >
        Run ID: {run.runId}
      </div>

      {/* CSS animation for pulsing dot */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
