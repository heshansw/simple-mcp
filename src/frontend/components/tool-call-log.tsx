import { useState } from "react";
import type { AgentRunStepItem } from "@frontend/api/agent-executions.api";

type ToolCallLogProps = {
  steps: AgentRunStepItem[];
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolCallLog({ steps }: ToolCallLogProps) {
  const toolCalls = steps.filter((s) => s.stepType === "tool_call");
  const [sortBy, setSortBy] = useState<"index" | "duration">("index");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const sorted = [...toolCalls].sort((a, b) => {
    if (sortBy === "duration") return b.durationMs - a.durationMs;
    return a.stepIndex - b.stepIndex;
  });

  if (toolCalls.length === 0) {
    return (
      <div style={{ padding: "1.5rem", color: "#9ca3af", textAlign: "center" }}>
        No tool calls recorded.
      </div>
    );
  }

  return (
    <div style={{ overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
        <thead>
          <tr>
            <th style={thStyle}>#</th>
            <th style={thStyle}>Tool Name</th>
            <th style={thStyle}>Arguments</th>
            <th style={thStyle}>Result</th>
            <th
              style={{ ...thStyle, cursor: "pointer", userSelect: "none" }}
              onClick={() => setSortBy(sortBy === "duration" ? "index" : "duration")}
            >
              Duration {sortBy === "duration" ? "▼" : ""}
            </th>
            <th style={thStyle}>Error</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((step) => {
            const isExpanded = expandedRow === step.id;
            return (
              <tr
                key={step.id}
                onClick={() => setExpandedRow(isExpanded ? null : step.id)}
                style={{
                  borderBottom: "1px solid #e5e7eb",
                  cursor: "pointer",
                  backgroundColor: step.toolIsError === 1 ? "#fef2f2" : "transparent",
                }}
              >
                <td style={tdStyle}>{step.stepIndex + 1}</td>
                <td style={{ ...tdStyle, fontWeight: "500" }}>{step.toolName}</td>
                <td style={{ ...tdStyle, maxWidth: "200px" }}>
                  <div
                    style={{
                      overflow: isExpanded ? "visible" : "hidden",
                      textOverflow: isExpanded ? "unset" : "ellipsis",
                      whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
                      maxHeight: isExpanded ? "none" : "1.5em",
                      fontFamily: "monospace",
                      fontSize: "0.6875rem",
                    }}
                  >
                    {step.toolArgs ?? "—"}
                  </div>
                </td>
                <td style={{ ...tdStyle, maxWidth: "250px" }}>
                  <div
                    style={{
                      overflow: isExpanded ? "visible" : "hidden",
                      textOverflow: isExpanded ? "unset" : "ellipsis",
                      whiteSpace: isExpanded ? "pre-wrap" : "nowrap",
                      maxHeight: isExpanded ? "none" : "1.5em",
                      fontFamily: "monospace",
                      fontSize: "0.6875rem",
                    }}
                  >
                    {step.toolResult ?? "—"}
                  </div>
                </td>
                <td style={tdStyle}>{formatDuration(step.durationMs)}</td>
                <td style={tdStyle}>
                  {step.toolIsError === 1 ? (
                    <span style={{ color: "#ef4444", fontWeight: "600" }}>Yes</span>
                  ) : (
                    <span style={{ color: "#10b981" }}>—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  textAlign: "left",
  backgroundColor: "#f9fafb",
  fontWeight: "600",
  fontSize: "0.6875rem",
  textTransform: "uppercase",
  color: "#6b7280",
  borderBottom: "1px solid #e5e7eb",
};

const tdStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  fontSize: "0.8125rem",
  color: "#374151",
  verticalAlign: "top",
};
