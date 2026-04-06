import { Link } from "@tanstack/react-router";
import type { DelegationNode } from "@frontend/api/agent-executions.api";
import { RunStatusBadge } from "@frontend/components/run-status-badge";

type DelegationTreeProps = {
  tree: DelegationNode;
};

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "Running...";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

function TreeNode({ node, depth }: { node: DelegationNode; depth: number }) {
  return (
    <div style={{ marginLeft: depth > 0 ? "1.5rem" : 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 0.75rem",
          backgroundColor: depth === 0 ? "#f0f9ff" : "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "0.375rem",
          marginBottom: "0.5rem",
        }}
      >
        {depth > 0 && (
          <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>{"└─"}</span>
        )}
        <span
          style={{
            fontSize: "0.625rem",
            fontWeight: "600",
            color: "#6b7280",
            backgroundColor: "#f3f4f6",
            padding: "0.125rem 0.375rem",
            borderRadius: "0.25rem",
          }}
        >
          L{depth}
        </span>
        <RunStatusBadge status={node.run.status} />
        <Link
          to="/agent-executions/$runId"
          params={{ runId: node.run.id }}
          style={{
            color: "#3b82f6",
            textDecoration: "none",
            fontWeight: "500",
            fontSize: "0.875rem",
          }}
        >
          {node.run.agentId}
        </Link>
        <span
          style={{
            fontSize: "0.75rem",
            color: "#6b7280",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {truncateText(node.run.goal, 60)}
        </span>
        <span style={{ fontSize: "0.6875rem", color: "#9ca3af" }}>
          {formatDuration(node.run.startedAt, node.run.completedAt)}
        </span>
      </div>
      {node.children.map((child) => (
        <TreeNode key={child.run.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function DelegationTree({ tree }: DelegationTreeProps) {
  const hasChildren = tree.children.length > 0;

  if (!hasChildren) {
    return (
      <div style={{ padding: "1.5rem", color: "#9ca3af", textAlign: "center" }}>
        No delegations in this run.
      </div>
    );
  }

  return <TreeNode node={tree} depth={0} />;
}
