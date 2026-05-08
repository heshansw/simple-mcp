import { useCodeHealthProjects, useTriggerSnapshot, useBackgroundJobs } from "@frontend/api/code-health.api";
import type { BackgroundJob } from "@frontend/api/code-health.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { HealthScoreBadge } from "@frontend/components/health-score-badge";
import { Link } from "@tanstack/react-router";

function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#16a34a";
    case "B": return "#65a30d";
    case "C": return "#ca8a04";
    case "D": return "#ea580c";
    case "F": return "#dc2626";
    default: return "#6b7280";
  }
}

function BackgroundActivityFeed() {
  const { data: jobs } = useBackgroundJobs();
  const completed = (jobs ?? []).filter((j: BackgroundJob) => j.status === "completed").slice(0, 10);

  if (completed.length === 0) return null;

  return (
    <div style={{ marginTop: "2rem" }}>
      <h2 style={{ margin: "0 0 0.75rem", fontSize: "1.1rem", fontWeight: "600" }}>Recent Background Analysis</h2>
      <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
        {completed.map((job: BackgroundJob) => (
          <div key={job.id} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.625rem 1rem", borderBottom: "1px solid #f3f4f6", fontSize: "0.8rem" }}>
            {job.grade && (
              <span style={{ fontWeight: "700", color: gradeColor(job.grade), minWidth: "1.5rem", textAlign: "center" }}>{job.grade}</span>
            )}
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#374151" }}>
              {job.filePath.split("/").slice(-2).join("/")}
            </span>
            {job.score != null && (
              <span style={{ fontWeight: "600", color: "#6b7280" }}>{job.score.toFixed(1)}/10</span>
            )}
            <span style={{ color: "#9ca3af", fontSize: "0.7rem", minWidth: "4rem", textAlign: "right" }}>
              {job.triggerTool}
            </span>
            <span style={{ color: "#9ca3af", fontSize: "0.7rem" }}>
              {job.completedAt ? new Date(job.completedAt).toLocaleTimeString() : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function CodeHealthProjectsPage() {
  const { data: projects, isLoading, error } = useCodeHealthProjects();
  const triggerSnapshot = useTriggerSnapshot();

  if (isLoading) return <LoadingSpinner message="Loading projects..." />;
  if (error) return <ErrorDisplay error={error} message="Failed to load projects" />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: "700" }}>Code Health</h1>
          <p style={{ margin: "0.25rem 0 0", color: "#6b7280", fontSize: "0.875rem" }}>
            Monitor code quality across your projects
          </p>
        </div>
      </div>

      {!projects || projects.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", backgroundColor: "#fff", borderRadius: "0.5rem", border: "1px solid #e5e7eb" }}>
          <p style={{ color: "#6b7280", margin: 0 }}>No projects configured yet. Add workspaces in Local Repos to get started.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
          {projects.map(project => (
            <div key={project.id} style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1.25rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.75rem" }}>
                <div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
                  <Link to={"/code-health/$projectId" as string} params={{ projectId: project.id }} style={{ fontWeight: "600", fontSize: "1rem", color: "#1f2937", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {project.name}
                  </Link>
                  <div style={{ fontSize: "0.7rem", color: "#9ca3af", marginTop: "0.25rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.directoryPath}</div>
                </div>
                {project.latestScore != null && project.latestGrade != null && (
                  <div style={{ flexShrink: 0 }}>
                    <HealthScoreBadge score={project.latestScore} grade={project.latestGrade} size={40} />
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: "1rem", fontSize: "0.8rem", color: "#6b7280" }}>
                {project.fileCount > 0 && <span>{project.fileCount} files scanned</span>}
                {project.lastAnalyzedAt && <span>Last: {new Date(project.lastAnalyzedAt).toLocaleDateString()}</span>}
              </div>
              <button
                onClick={() => triggerSnapshot.mutate(project.id)}
                disabled={triggerSnapshot.isPending}
                style={{
                  marginTop: "auto",
                  padding: "0.375rem 0.75rem",
                  backgroundColor: triggerSnapshot.isPending ? "#d1d5db" : "#3b82f6",
                  color: "#fff",
                  border: "none",
                  borderRadius: "0.375rem",
                  fontSize: "0.8rem",
                  cursor: triggerSnapshot.isPending ? "default" : "pointer",
                  alignSelf: "flex-start",
                }}
              >
                {triggerSnapshot.isPending ? "Analyzing..." : "Analyze Now"}
              </button>
            </div>
          ))}
        </div>
      )}

      <BackgroundActivityFeed />
    </div>
  );
}
