import { Link } from "@tanstack/react-router";
import type { AgentDefinition } from "@shared/schemas/agent.schema";

type AgentCardProps = {
  agent: AgentDefinition;
  enabled: boolean;
  onToggle?: (enabled: boolean) => void;
  isLoading?: boolean;
};

export function AgentCard({
  agent,
  enabled,
  onToggle,
  isLoading,
}: AgentCardProps) {
  return (
    <div
      style={{
        padding: "1rem",
        border: "1px solid #e5e7eb",
        borderRadius: "0.375rem",
        backgroundColor: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "start",
          marginBottom: "0.75rem",
        }}
      >
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: "0 0 0.25rem 0", fontSize: "1.125rem" }}>
            {agent.name}
          </h3>
          <p style={{ margin: "0", fontSize: "0.875rem", color: "#666" }}>
            v{agent.version}
          </p>
        </div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onToggle?.(e.target.checked)}
            disabled={isLoading}
            style={{ cursor: "pointer" }}
          />
          <span style={{ fontSize: "0.875rem" }}>
            {enabled ? "Enabled" : "Disabled"}
          </span>
        </label>
      </div>

      {agent.description && (
        <p style={{ margin: "0.5rem 0", fontSize: "0.875rem", color: "#666" }}>
          {agent.description}
        </p>
      )}

      {agent.requiredIntegrations && agent.requiredIntegrations.length > 0 && (
        <p style={{ margin: "0.5rem 0", fontSize: "0.875rem", color: "#999" }}>
          Requires: {agent.requiredIntegrations.join(", ")}
        </p>
      )}

      <div style={{ marginTop: "1rem" }}>
        <Link
          to={`/agents/$agentId`}
          params={{ agentId: agent.id }}
          style={{
            display: "inline-block",
            padding: "0.5rem 1rem",
            backgroundColor: "#3b82f6",
            color: "#fff",
            textDecoration: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          Configure
        </Link>
      </div>
    </div>
  );
}
