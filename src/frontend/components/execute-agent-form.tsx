import { useState } from "react";
import { useExecuteAgent } from "@frontend/api/agent-executions.api";
import type { AgentRunResult } from "@frontend/api/agent-executions.api";
import { ErrorDisplay } from "@frontend/components/error-display";

type AgentOption = {
  id: string;
  name: string;
};

type ExecuteAgentFormProps = {
  agents: AgentOption[];
  preselectedAgentId?: string;
  onExecuted?: (result: AgentRunResult) => void;
  onCancel?: () => void;
};

export function ExecuteAgentForm({
  agents,
  preselectedAgentId,
  onExecuted,
  onCancel,
}: ExecuteAgentFormProps) {
  const [agentId, setAgentId] = useState(preselectedAgentId ?? (agents[0]?.id ?? ""));
  const [goal, setGoal] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [maxIterations, setMaxIterations] = useState("");
  const [maxToolCalls, setMaxToolCalls] = useState("");
  const [maxTokens, setMaxTokens] = useState("");

  const executeAgent = useExecuteAgent();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentId || !goal.trim()) return;

    const config: Record<string, number> = {};
    if (maxIterations) config.maxIterations = Number(maxIterations);
    if (maxToolCalls) config.maxToolCalls = Number(maxToolCalls);
    if (maxTokens) config.maxTokens = Number(maxTokens);

    const result = await executeAgent.mutateAsync({
      agentId,
      goal: goal.trim(),
      ...(Object.keys(config).length > 0 ? { config } : {}),
    });

    onExecuted?.(result);
  };

  return (
    <div
      style={{
        backgroundColor: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "0.375rem",
        padding: "1.5rem",
        marginBottom: "1.5rem",
      }}
    >
      <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.125rem", fontWeight: "600" }}>
        Execute Agent
      </h3>

      {executeAgent.error && (
        <div style={{ marginBottom: "1rem" }}>
          <ErrorDisplay error={executeAgent.error} message="Agent execution failed" />
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Agent Selector */}
        <div style={{ marginBottom: "1rem" }}>
          <label
            htmlFor="agent-select"
            style={{
              display: "block",
              marginBottom: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: "500",
              color: "#374151",
            }}
          >
            Agent
          </label>
          <select
            id="agent-select"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={!!preselectedAgentId}
            style={{
              width: "100%",
              padding: "0.5rem 0.75rem",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              backgroundColor: preselectedAgentId ? "#f9fafb" : "#fff",
              color: "#111827",
            }}
          >
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </div>

        {/* Goal */}
        <div style={{ marginBottom: "1rem" }}>
          <label
            htmlFor="goal-input"
            style={{
              display: "block",
              marginBottom: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: "500",
              color: "#374151",
            }}
          >
            Goal
          </label>
          <textarea
            id="goal-input"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={4}
            placeholder="Describe what the agent should accomplish..."
            style={{
              width: "100%",
              padding: "0.5rem 0.75rem",
              border: "1px solid #d1d5db",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontFamily: "inherit",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Advanced Options Toggle */}
        <div style={{ marginBottom: "1rem" }}>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{
              background: "none",
              border: "none",
              color: "#3b82f6",
              fontSize: "0.875rem",
              cursor: "pointer",
              padding: "0",
              textDecoration: "underline",
            }}
          >
            {showAdvanced ? "Hide advanced options" : "Show advanced options"}
          </button>
        </div>

        {/* Advanced Options */}
        {showAdvanced && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: "1rem",
              marginBottom: "1rem",
              padding: "1rem",
              backgroundColor: "#f9fafb",
              borderRadius: "0.375rem",
            }}
          >
            <div>
              <label
                htmlFor="max-iterations"
                style={{
                  display: "block",
                  marginBottom: "0.25rem",
                  fontSize: "0.75rem",
                  fontWeight: "500",
                  color: "#6b7280",
                }}
              >
                Max Iterations
              </label>
              <input
                id="max-iterations"
                type="number"
                value={maxIterations}
                onChange={(e) => setMaxIterations(e.target.value)}
                placeholder="25"
                min="1"
                max="100"
                style={{
                  width: "100%",
                  padding: "0.375rem 0.5rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.375rem",
                  fontSize: "0.875rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label
                htmlFor="max-tool-calls"
                style={{
                  display: "block",
                  marginBottom: "0.25rem",
                  fontSize: "0.75rem",
                  fontWeight: "500",
                  color: "#6b7280",
                }}
              >
                Max Tool Calls
              </label>
              <input
                id="max-tool-calls"
                type="number"
                value={maxToolCalls}
                onChange={(e) => setMaxToolCalls(e.target.value)}
                placeholder="100"
                min="1"
                max="500"
                style={{
                  width: "100%",
                  padding: "0.375rem 0.5rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.375rem",
                  fontSize: "0.875rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div>
              <label
                htmlFor="max-tokens"
                style={{
                  display: "block",
                  marginBottom: "0.25rem",
                  fontSize: "0.75rem",
                  fontWeight: "500",
                  color: "#6b7280",
                }}
              >
                Max Tokens
              </label>
              <input
                id="max-tokens"
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="200000"
                min="1000"
                style={{
                  width: "100%",
                  padding: "0.375rem 0.5rem",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.375rem",
                  fontSize: "0.875rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
          </div>
        )}

        {/* Buttons */}
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            type="submit"
            disabled={executeAgent.isPending || !agentId || !goal.trim()}
            style={{
              padding: "0.5rem 1.25rem",
              backgroundColor: executeAgent.isPending || !agentId || !goal.trim() ? "#93c5fd" : "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: "500",
              cursor: executeAgent.isPending || !agentId || !goal.trim() ? "not-allowed" : "pointer",
            }}
          >
            {executeAgent.isPending ? "Executing..." : "Execute Agent"}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={executeAgent.isPending}
              style={{
                padding: "0.5rem 1.25rem",
                backgroundColor: "#fff",
                color: "#374151",
                border: "1px solid #d1d5db",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                fontWeight: "500",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
