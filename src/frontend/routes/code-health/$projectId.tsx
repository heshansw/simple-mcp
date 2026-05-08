import { useCodeHealthProject, useCodeHealthTrends, useCodeHealthEvents, useProjectScannedFiles } from "@frontend/api/code-health.api";
import type { BackgroundJob, HealthIssue } from "@frontend/api/code-health.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import { HealthScoreBadge } from "@frontend/components/health-score-badge";
import { HealthTrendChart } from "@frontend/components/health-trend-chart";
import { useParams } from "@tanstack/react-router";
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

function fileScoreBg(score: number): string {
  if (score >= 8.5) return "#f0fdf4";
  if (score >= 7.0) return "#fefce8";
  if (score >= 5.0) return "#fffbeb";
  if (score >= 3.0) return "#fef2f2";
  return "#fef2f2";
}

function shortenPath(filePath: string, basePath: string): string {
  if (filePath.startsWith(basePath)) {
    return filePath.slice(basePath.length).replace(/^\//, "");
  }
  return filePath.split("/").slice(-3).join("/");
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function CodeHealthProjectDetailPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { data, isLoading, error } = useCodeHealthProject(projectId);
  const { data: trends } = useCodeHealthTrends(projectId);
  const { data: scannedFiles } = useProjectScannedFiles(projectId);
  const { data: events } = useCodeHealthEvents(projectId);

  if (isLoading) return <LoadingSpinner message="Loading project..." />;
  if (error) return <ErrorDisplay error={error} message="Failed to load project" />;
  if (!data) return <div>Project not found</div>;

  const { project, snapshot } = data;
  const completedFiles = (scannedFiles ?? []).filter((f: BackgroundJob) => f.score != null);

  // Compute average score from scanned files
  const avgScore = completedFiles.length > 0
    ? completedFiles.reduce((sum: number, f: BackgroundJob) => sum + (f.score ?? 0), 0) / completedFiles.length
    : null;

  // Collect all issues across all scanned files
  const allIssues: Array<{ file: string; issue: HealthIssue }> = [];
  for (const f of completedFiles) {
    const issues: HealthIssue[] = JSON.parse(f.issuesJson || "[]");
    for (const issue of issues) {
      allIssues.push({ file: shortenPath(f.filePath, project.directoryPath), issue });
    }
  }
  const totalIssues = allIssues.length;
  const criticalCount = allIssues.filter(i => i.issue.severity === "critical").length;
  const warningCount = allIssues.filter(i => i.issue.severity === "warning").length;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: "1.5rem" }}>
        <Link to="/code-health" style={{ fontSize: "0.8rem", color: "#3b82f6", textDecoration: "none" }}>
          ← Back to Projects
        </Link>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem", gap: "1rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: "1.5rem", fontWeight: "700" }}>{project.name}</h1>
            <p style={{ margin: "0.25rem 0 0", color: "#9ca3af", fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.directoryPath}</p>
          </div>
          {snapshot && (
            <div style={{ flexShrink: 0 }}>
              <HealthScoreBadge score={snapshot.overallScore} grade={snapshot.grade} size={56} />
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.5rem" }}>
        <StatCard label="Files Scanned" value={completedFiles.length} />
        {avgScore != null && <StatCard label="Avg Score" value={avgScore.toFixed(1)} />}
        {totalIssues > 0 && <StatCard label="Total Issues" value={totalIssues} color={criticalCount > 0 ? "#dc2626" : "#ca8a04"} />}
        {criticalCount > 0 && <StatCard label="Critical" value={criticalCount} color="#dc2626" />}
        {warningCount > 0 && <StatCard label="Warnings" value={warningCount} color="#ca8a04" />}
      </div>

      {/* Trend chart */}
      {trends && trends.length > 1 && (
        <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1.5rem" }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: "600" }}>Score Trend</h3>
          <HealthTrendChart dataPoints={trends} width={600} height={120} />
        </div>
      )}

      {/* Scanned Files - the main section */}
      <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1.5rem" }}>
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: "600" }}>
          Scanned Files ({completedFiles.length})
        </h3>
        {completedFiles.length === 0 ? (
          <p style={{ color: "#9ca3af", fontSize: "0.85rem", margin: "1rem 0" }}>
            No files scanned yet. Files are automatically analyzed when accessed via MCP tools (e.g., fs_read_file).
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            {completedFiles
              .sort((a: BackgroundJob, b: BackgroundJob) => (a.score ?? 10) - (b.score ?? 10))
              .map((f: BackgroundJob) => (
                <div key={f.id} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.625rem",
                  padding: "0.5rem 0.625rem",
                  borderRadius: "0.375rem",
                  backgroundColor: fileScoreBg(f.score ?? 10),
                  transition: "background-color 0.15s",
                }}>
                  {/* Grade badge */}
                  <span style={{
                    fontWeight: "700",
                    fontSize: "0.75rem",
                    color: gradeColor(f.grade ?? ""),
                    minWidth: "1.25rem",
                    textAlign: "center",
                  }}>
                    {f.grade ?? "—"}
                  </span>
                  {/* Score */}
                  <span style={{
                    fontWeight: "600",
                    fontSize: "0.8rem",
                    color: "#374151",
                    minWidth: "2.25rem",
                    textAlign: "right",
                  }}>
                    {f.score != null ? f.score.toFixed(1) : "—"}
                  </span>
                  {/* File path */}
                  <span style={{
                    flex: 1,
                    fontSize: "0.8rem",
                    color: "#1f2937",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {shortenPath(f.filePath, project.directoryPath)}
                  </span>
                  {/* Issues count */}
                  {f.issueCount > 0 && (
                    <span style={{
                      fontSize: "0.7rem",
                      color: "#dc2626",
                      backgroundColor: "#fef2f2",
                      padding: "0.125rem 0.375rem",
                      borderRadius: "0.25rem",
                      fontWeight: "500",
                    }}>
                      {f.issueCount} issues
                    </span>
                  )}
                  {/* Trigger tool */}
                  <span style={{ fontSize: "0.65rem", color: "#9ca3af", minWidth: "5rem", textAlign: "right" }}>
                    {f.triggerTool}
                  </span>
                  {/* Time */}
                  <span style={{ fontSize: "0.65rem", color: "#9ca3af", minWidth: "3.5rem", textAlign: "right" }}>
                    {f.completedAt ? timeAgo(f.completedAt) : ""}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Issues - grouped by file */}
      {allIssues.length > 0 && (
        <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem", marginBottom: "1.5rem" }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: "600" }}>
            Issues ({totalIssues})
            {criticalCount > 0 && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#dc2626", fontWeight: "500" }}>{criticalCount} critical</span>}
            {warningCount > 0 && <span style={{ marginLeft: "0.5rem", fontSize: "0.75rem", color: "#ca8a04", fontWeight: "500" }}>{warningCount} warnings</span>}
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
            {(() => {
              // Group issues by file
              const grouped = new Map<string, Array<{ file: string; issue: HealthIssue }>>();
              for (const entry of allIssues) {
                const existing = grouped.get(entry.file) ?? [];
                existing.push(entry);
                grouped.set(entry.file, existing);
              }
              return Array.from(grouped.entries()).map(([file, entries]) => (
                <div key={file} style={{ marginBottom: "0.75rem" }}>
                  <div style={{ fontSize: "0.8rem", fontWeight: "600", color: "#374151", padding: "0.375rem 0", borderBottom: "1px solid #e5e7eb", marginBottom: "0.25rem" }}>
                    {file}
                  </div>
                  {entries.map((entry, idx) => (
                    <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.375rem 0.5rem", fontSize: "0.8rem" }}>
                      <span style={{
                        fontSize: "0.65rem",
                        fontWeight: "600",
                        padding: "0.1rem 0.375rem",
                        borderRadius: "0.25rem",
                        flexShrink: 0,
                        backgroundColor: entry.issue.severity === "critical" ? "#fef2f2" : entry.issue.severity === "warning" ? "#fffbeb" : "#eff6ff",
                        color: entry.issue.severity === "critical" ? "#dc2626" : entry.issue.severity === "warning" ? "#ca8a04" : "#2563eb",
                      }}>
                        {entry.issue.severity.toUpperCase()}
                      </span>
                      <span style={{ fontSize: "0.7rem", color: "#6b7280", minWidth: "5rem", flexShrink: 0 }}>
                        {entry.issue.signal}
                      </span>
                      {entry.issue.line && (
                        <span style={{ fontSize: "0.7rem", color: "#9ca3af", flexShrink: 0 }}>
                          L{entry.issue.line}
                        </span>
                      )}
                      <span style={{ flex: 1, color: "#374151" }}>
                        {entry.issue.message}
                      </span>
                      {entry.issue.suggestion && (
                        <span style={{ fontSize: "0.7rem", color: "#3b82f6", flexShrink: 0, maxWidth: "30%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={entry.issue.suggestion}>
                          {entry.issue.suggestion}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Recent events */}
      {events && events.length > 0 && (
        <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem" }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: "600" }}>Recent Events</h3>
          {events.slice(0, 10).map(e => (
            <div key={e.id} style={{ display: "flex", gap: "0.75rem", padding: "0.5rem 0", borderBottom: "1px solid #f3f4f6", fontSize: "0.8rem" }}>
              <span style={{ fontWeight: "500", minWidth: "100px" }}>{e.eventType}</span>
              {e.afterScore != null && <span>Score: {e.afterScore.toFixed(1)}</span>}
              <span style={{ color: "#9ca3af" }}>{new Date(e.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "0.75rem 1rem" }}>
      <div style={{ fontSize: "0.65rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: "700", color: color ?? "#1f2937" }}>{value}</div>
    </div>
  );
}
