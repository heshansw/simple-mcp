import { useCodeHealthSessions } from "@frontend/api/code-health.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";

export function CodeHealthSessionsPage() {
  const { data: sessions, isLoading, error } = useCodeHealthSessions();

  if (isLoading) return <LoadingSpinner message="Loading sessions..." />;
  if (error) return <ErrorDisplay error={error} message="Failed to load sessions" />;

  return (
    <div>
      <h1 style={{ margin: "0 0 1rem", fontSize: "1.5rem", fontWeight: "700" }}>Coding Sessions</h1>
      <p style={{ margin: "0 0 1.5rem", color: "#6b7280", fontSize: "0.875rem" }}>
        Track code quality changes during coding sessions
      </p>

      {!sessions || sessions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", backgroundColor: "#fff", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}>
          <p style={{ color: "#6b7280", margin: 0 }}>No sessions recorded yet.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {sessions.map(session => {
            const files: string[] = JSON.parse(session.filesChanged || "[]");
            const initial: Record<string, number> = JSON.parse(session.initialScoresJson || "{}");
            const final_: Record<string, number> = JSON.parse(session.finalScoresJson || "{}");
            const isActive = session.status === "active";
            const achieved = session.achievedTarget === 1;

            return (
              <div key={session.id} style={{
                backgroundColor: "#fff",
                border: `1px solid ${isActive ? "#3b82f6" : "#e5e7eb"}`,
                borderLeft: `3px solid ${isActive ? "#3b82f6" : achieved ? "#16a34a" : "#ea580c"}`,
                borderRadius: "0.5rem",
                padding: "1rem 1.25rem",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{
                      padding: "0.125rem 0.5rem",
                      borderRadius: "1rem",
                      fontSize: "0.7rem",
                      fontWeight: "600",
                      backgroundColor: isActive ? "#dbeafe" : achieved ? "#dcfce7" : "#fef2f2",
                      color: isActive ? "#2563eb" : achieved ? "#16a34a" : "#dc2626",
                    }}>
                      {session.status.toUpperCase()}
                    </span>
                    <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
                      {new Date(session.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <span style={{ fontSize: "0.8rem", fontWeight: "500" }}>
                    Target: {session.targetScore}/10 | Iterations: {session.totalIterations}
                  </span>
                </div>
                <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                  {files.length} files tracked
                </div>
                {files.length > 0 && (
                  <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.125rem" }}>
                    {files.slice(0, 5).map(f => {
                      const before = initial[f];
                      const after = final_[f];
                      return (
                        <div key={f} style={{ fontSize: "0.75rem", display: "flex", gap: "0.5rem" }}>
                          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f}</span>
                          {before != null && <span style={{ color: "#9ca3af" }}>{before.toFixed(1)}</span>}
                          {before != null && after != null && <span>→</span>}
                          {after != null && <span style={{ color: after >= session.targetScore ? "#16a34a" : "#dc2626", fontWeight: "600" }}>{after.toFixed(1)}</span>}
                        </div>
                      );
                    })}
                    {files.length > 5 && <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>+{files.length - 5} more</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
