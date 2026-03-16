import { useAgents, useUpdateAgentConfig } from "@frontend/api/agents.api";
import { AgentCard } from "@frontend/components/agent-card";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";

export function AgentsListPage() {
  const { data: agents, isLoading, error } = useAgents();
  const updateAgentConfig = useUpdateAgentConfig();

  if (isLoading) {
    return <LoadingSpinner message="Loading agents..." />;
  }

  if (error) {
    return <ErrorDisplay error={error} message="Failed to load agents" />;
  }

  const handleToggle = async (agentId: string, enabled: boolean) => {
    try {
      await updateAgentConfig.mutateAsync({
        agentId,
        enabled,
        parameterOverrides: {},
        linkedConnectionIds: [],
      });
    } catch (err) {
      // Error is displayed by updateAgentConfig.error
    }
  };

  return (
    <div>
      <h1 style={{ marginTop: "0", marginBottom: "2rem" }}>Agents</h1>

      {updateAgentConfig.error && (
        <ErrorDisplay
          error={updateAgentConfig.error}
          message="Failed to update agent"
        />
      )}

      {agents && agents.length === 0 ? (
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
          <p>No agents available.</p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
            gap: "1rem",
          }}
        >
          {agents?.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              enabled={true}
              onToggle={(enabled) => handleToggle(agent.id, enabled)}
              isLoading={updateAgentConfig.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
