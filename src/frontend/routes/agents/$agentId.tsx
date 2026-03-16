import { useParams } from "@tanstack/react-router";
import { useAgent, useAgentConfig, useUpdateAgentConfig } from "@frontend/api/agents.api";
import { useConnections } from "@frontend/api/connections.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { useState, useEffect } from "react";

export function AgentDetailPage() {
  const { agentId } = useParams({ from: "/agents/$agentId" });
  const { data: agent, isLoading: agentLoading, error: agentError } = useAgent(agentId);
  const { data: config, isLoading: configLoading } = useAgentConfig(agentId);
  const { data: connections } = useConnections();
  const updateAgentConfig = useUpdateAgentConfig();
  const [selectedConnections, setSelectedConnections] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (config) {
      setSelectedConnections(config.linkedConnectionIds);
      setEnabled(config.enabled);
    }
  }, [config]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      await updateAgentConfig.mutateAsync({
        agentId,
        enabled,
        parameterOverrides: {},
        linkedConnectionIds: selectedConnections,
      });
    } catch (err) {
      // Error is displayed by updateAgentConfig.error
    }
  };

  if (agentLoading || configLoading) {
    return <LoadingSpinner message="Loading agent..." />;
  }

  if (agentError || !agent) {
    return <ErrorDisplay error={agentError} message="Failed to load agent" />;
  }

  return (
    <div>
      <h1 style={{ marginTop: "0", marginBottom: "2rem" }}>{agent.name}</h1>

      {updateAgentConfig.error && (
        <ErrorDisplay
          error={updateAgentConfig.error}
          message="Failed to update agent config"
        />
      )}

      {agent.description && (
        <p style={{ color: "#666", marginBottom: "2rem" }}>
          {agent.description}
        </p>
      )}

      <div
        style={{
          maxWidth: "600px",
          padding: "2rem",
          backgroundColor: "#fff",
          borderRadius: "0.375rem",
          border: "1px solid #e5e7eb",
        }}
      >
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1.5rem" }}>
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
                onChange={(e) => setEnabled(e.target.checked)}
                style={{ cursor: "pointer" }}
              />
              <span style={{ fontWeight: "500" }}>Enable this agent</span>
            </label>
          </div>

          {agent.requiredIntegrations && agent.requiredIntegrations.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ marginTop: "0" }}>Required Integrations</h3>
              <p style={{ color: "#666", fontSize: "0.875rem" }}>
                This agent requires: {agent.requiredIntegrations.join(", ")}
              </p>
            </div>
          )}

          <div style={{ marginBottom: "1.5rem" }}>
            <label
              htmlFor="connections"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: "500",
                fontSize: "0.875rem",
              }}
            >
              Linked Connections
            </label>
            <div
              style={{
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                maxHeight: "200px",
                overflowY: "auto",
              }}
            >
              {connections && connections.length > 0 ? (
                <div>
                  {connections.map((conn) => (
                    <label
                      key={conn.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.75rem",
                        borderBottom: "1px solid #e5e7eb",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedConnections.includes(conn.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedConnections([
                              ...selectedConnections,
                              conn.id,
                            ]);
                          } else {
                            setSelectedConnections(
                              selectedConnections.filter((id) => id !== conn.id)
                            );
                          }
                        }}
                        style={{ cursor: "pointer" }}
                      />
                      <span>
                        {conn.name} ({conn.integrationType})
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <div style={{ padding: "1rem", color: "#999", textAlign: "center" }}>
                  No connections available
                </div>
              )}
            </div>
          </div>

          <button
            type="submit"
            disabled={updateAgentConfig.isPending}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: "#10b981",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "1rem",
              fontWeight: "500",
              cursor: "pointer",
              opacity: updateAgentConfig.isPending ? 0.6 : 1,
            }}
          >
            {updateAgentConfig.isPending ? "Saving..." : "Save Configuration"}
          </button>
        </form>
      </div>
    </div>
  );
}
