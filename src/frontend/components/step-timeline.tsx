import { useState } from "react";
import type { AgentRunStepItem } from "@frontend/api/agent-executions.api";

type StepTimelineProps = {
  steps: AgentRunStepItem[];
  total: number;
};

const STEP_ICONS: Record<string, string> = {
  llm_call: "🧠",
  tool_call: "🔧",
  delegation: "📤",
  plan: "📋",
  error: "❌",
  guardrail: "🛡️",
};

const STEP_COLORS: Record<string, string> = {
  llm_call: "#8b5cf6",
  tool_call: "#3b82f6",
  delegation: "#f59e0b",
  plan: "#10b981",
  error: "#ef4444",
  guardrail: "#f97316",
};

function formatTimestamp(ts: string): string {
  return new Date(ts).toLocaleTimeString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function StepTimeline({ steps, total }: StepTimelineProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

  const toggleExpand = (index: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  if (steps.length === 0) {
    return (
      <div style={{ padding: "1.5rem", color: "#9ca3af", textAlign: "center" }}>
        No steps recorded yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: "0.75rem" }}>
        Showing {steps.length} of {total} steps
      </div>
      <div style={{ position: "relative", paddingLeft: "2rem" }}>
        {/* Vertical line */}
        <div
          style={{
            position: "absolute",
            left: "0.75rem",
            top: "0.5rem",
            bottom: "0.5rem",
            width: "2px",
            backgroundColor: "#e5e7eb",
          }}
        />
        {steps.map((step, idx) => {
          const expanded = expandedSteps.has(idx);
          const color = STEP_COLORS[step.stepType] ?? "#6b7280";
          const icon = STEP_ICONS[step.stepType] ?? "•";
          return (
            <div
              key={step.id}
              style={{
                position: "relative",
                marginBottom: "0.75rem",
                paddingBottom: "0.75rem",
                borderBottom: idx < steps.length - 1 ? "1px solid #f3f4f6" : "none",
              }}
            >
              {/* Dot */}
              <div
                style={{
                  position: "absolute",
                  left: "-1.625rem",
                  top: "0.25rem",
                  width: "1.25rem",
                  height: "1.25rem",
                  borderRadius: "50%",
                  backgroundColor: color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.625rem",
                  zIndex: 1,
                }}
              >
                <span style={{ filter: "grayscale(0)" }}>{icon}</span>
              </div>

              {/* Header */}
              <div
                onClick={() => toggleExpand(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: "600",
                    color,
                    textTransform: "uppercase",
                  }}
                >
                  {step.stepType.replace("_", " ")}
                </span>
                {step.toolName && (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: "500",
                      color: "#374151",
                      backgroundColor: "#f3f4f6",
                      padding: "0.125rem 0.375rem",
                      borderRadius: "0.25rem",
                    }}
                  >
                    {step.toolName}
                  </span>
                )}
                {step.delegateTargetAgentId && (
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontWeight: "500",
                      color: "#92400e",
                      backgroundColor: "#fef3c7",
                      padding: "0.125rem 0.375rem",
                      borderRadius: "0.25rem",
                    }}
                  >
                    → {step.delegateTargetAgentId}
                  </span>
                )}
                {step.toolIsError === 1 && (
                  <span
                    style={{
                      fontSize: "0.625rem",
                      fontWeight: "600",
                      color: "#fff",
                      backgroundColor: "#ef4444",
                      padding: "0.125rem 0.375rem",
                      borderRadius: "0.25rem",
                    }}
                  >
                    ERROR
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: "0.625rem", color: "#9ca3af" }}>
                  {formatTimestamp(step.createdAt)}
                </span>
                {step.durationMs > 0 && (
                  <span style={{ fontSize: "0.625rem", color: "#9ca3af" }}>
                    {formatDuration(step.durationMs)}
                  </span>
                )}
                {(step.inputTokens > 0 || step.outputTokens > 0) && (
                  <span style={{ fontSize: "0.625rem", color: "#9ca3af" }}>
                    {step.inputTokens + step.outputTokens} tok
                  </span>
                )}
                <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>
                  {expanded ? "▼" : "▶"}
                </span>
              </div>

              {/* Expanded content */}
              {expanded && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.8125rem" }}>
                  {step.reasoning && (
                    <div style={{ marginBottom: "0.5rem" }}>
                      <div style={{ fontWeight: "600", color: "#374151", fontSize: "0.6875rem", marginBottom: "0.25rem" }}>
                        Reasoning
                      </div>
                      <pre
                        style={{
                          backgroundColor: "#f9fafb",
                          padding: "0.5rem",
                          borderRadius: "0.25rem",
                          border: "1px solid #e5e7eb",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontSize: "0.75rem",
                          maxHeight: "200px",
                          overflow: "auto",
                          margin: 0,
                        }}
                      >
                        {step.reasoning}
                      </pre>
                    </div>
                  )}
                  {step.toolArgs && (
                    <div style={{ marginBottom: "0.5rem" }}>
                      <div style={{ fontWeight: "600", color: "#374151", fontSize: "0.6875rem", marginBottom: "0.25rem" }}>
                        Arguments
                      </div>
                      <pre
                        style={{
                          backgroundColor: "#f0f9ff",
                          padding: "0.5rem",
                          borderRadius: "0.25rem",
                          border: "1px solid #bae6fd",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontSize: "0.75rem",
                          maxHeight: "150px",
                          overflow: "auto",
                          margin: 0,
                        }}
                      >
                        {tryFormatJson(step.toolArgs)}
                      </pre>
                    </div>
                  )}
                  {step.toolResult && (
                    <div>
                      <div style={{ fontWeight: "600", color: "#374151", fontSize: "0.6875rem", marginBottom: "0.25rem" }}>
                        Result
                      </div>
                      <pre
                        style={{
                          backgroundColor: step.toolIsError === 1 ? "#fef2f2" : "#f0fdf4",
                          padding: "0.5rem",
                          borderRadius: "0.25rem",
                          border: `1px solid ${step.toolIsError === 1 ? "#fecaca" : "#bbf7d0"}`,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontSize: "0.75rem",
                          maxHeight: "200px",
                          overflow: "auto",
                          margin: 0,
                        }}
                      >
                        {tryFormatJson(step.toolResult)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function tryFormatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}
