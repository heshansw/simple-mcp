import { useState } from "react";
import {
  useConfluenceSettings,
  useUpdateConfluenceSettings,
  useConfluenceInsights,
  useConfluenceActivity,
} from "@frontend/api/confluence.api";
import type { ConfluenceActivityEntry } from "@frontend/api/confluence.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";

// ── Helpers ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const TOOL_LABELS: Record<string, string> = {
  confluence_search_pages: "Search Pages",
  confluence_get_page: "Get Page",
  confluence_list_spaces: "List Spaces",
};

// ── Stat Card ────────────────────────────────────────────────────────

type StatCardProps = { label: string; value: string | number; color?: string };

function StatCard({ label, value, color = "#3b82f6" }: StatCardProps) {
  return (
    <div style={{
      padding: "1.25rem",
      backgroundColor: "#fff",
      border: "1px solid #e5e7eb",
      borderRadius: "0.5rem",
      borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 600, letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: "0.25rem", color: "#111827" }}>
        {value}
      </div>
    </div>
  );
}

// ── Space Allowlist Form ─────────────────────────────────────────────

function SpaceAllowlistForm() {
  const { data: settings, isLoading } = useConfluenceSettings();
  const updateSettings = useUpdateConfluenceSettings();
  const [inputValue, setInputValue] = useState("");
  const [initialized, setInitialized] = useState(false);

  if (isLoading) return <LoadingSpinner message="Loading settings..." />;

  if (settings && !initialized) {
    setInputValue(settings.allowedSpaceKeys.join(", "));
    setInitialized(true);
  }

  const handleSave = () => {
    const keys = inputValue
      .split(",")
      .map((k) => k.trim().toUpperCase())
      .filter((k) => k.length > 0);
    updateSettings.mutate({ allowedSpaceKeys: keys });
  };

  return (
    <div style={{ padding: "1rem", backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", marginBottom: "2rem" }}>
      <h3 style={{ margin: "0 0 0.5rem 0" }}>Space Allowlist</h3>
      <p style={{ fontSize: "0.8rem", color: "#666", margin: "0 0 1rem 0" }}>
        Restrict which Confluence spaces agents can access. Leave empty to allow all spaces.
      </p>

      {updateSettings.error && <ErrorDisplay error={updateSettings.error} message="Failed to update settings" />}

      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="ENG, DOCS, ARCH"
          style={{
            flex: 1,
            padding: "0.5rem",
            border: "1px solid #d1d5db",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
          }}
        />
        <button
          onClick={handleSave}
          disabled={updateSettings.isPending}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            cursor: "pointer",
            opacity: updateSettings.isPending ? 0.6 : 1,
          }}
        >
          {updateSettings.isPending ? "Saving..." : "Save"}
        </button>
      </div>

      {settings && settings.allowedSpaceKeys.length > 0 && (
        <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          {settings.allowedSpaceKeys.map((key) => (
            <span
              key={key}
              style={{
                padding: "0.2rem 0.6rem",
                borderRadius: "0.25rem",
                fontSize: "0.75rem",
                fontWeight: 600,
                backgroundColor: "#dbeafe",
                color: "#1e40af",
              }}
            >
              {key}
            </span>
          ))}
        </div>
      )}

      {settings && settings.allowedSpaceKeys.length === 0 && (
        <p style={{ fontSize: "0.75rem", color: "#10b981", marginTop: "0.5rem", marginBottom: 0 }}>
          All spaces permitted (no filter applied)
        </p>
      )}
    </div>
  );
}

// ── Tool Breakdown Chart ─────────────────────────────────────────────

function ToolBreakdown({ callsByTool }: { callsByTool: Record<string, number> }) {
  const total = Object.values(callsByTool).reduce((s, v) => s + v, 0);
  if (total === 0) return null;

  const colors: Record<string, string> = {
    confluence_search_pages: "#3b82f6",
    confluence_get_page: "#8b5cf6",
    confluence_list_spaces: "#10b981",
  };

  return (
    <div style={{ padding: "1rem", backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem" }}>
      <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem" }}>Calls by Tool</h4>
      {Object.entries(callsByTool).map(([tool, count]) => {
        const pct = Math.round((count / total) * 100);
        return (
          <div key={tool} style={{ marginBottom: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: "0.25rem" }}>
              <span>{TOOL_LABELS[tool] ?? tool}</span>
              <span style={{ color: "#666" }}>{count} ({pct}%)</span>
            </div>
            <div style={{ height: "6px", backgroundColor: "#f3f4f6", borderRadius: "3px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, backgroundColor: colors[tool] ?? "#6b7280", borderRadius: "3px" }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Space Breakdown ──────────────────────────────────────────────────

function SpaceBreakdown({ callsBySpace }: { callsBySpace: Record<string, number> }) {
  const entries = Object.entries(callsBySpace).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;

  return (
    <div style={{ padding: "1rem", backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem" }}>
      <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem" }}>Calls by Space</h4>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
        {entries.map(([space, count]) => (
          <span key={space} style={{
            padding: "0.3rem 0.6rem",
            borderRadius: "0.25rem",
            fontSize: "0.75rem",
            backgroundColor: "#ede9fe",
            color: "#5b21b6",
            fontWeight: 500,
          }}>
            {space}: {count}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Recent Activity Table ────────────────────────────────────────────

function ActivityTable({ activity }: { activity: ConfluenceActivityEntry[] }) {
  if (activity.length === 0) {
    return <p style={{ color: "#999", fontSize: "0.875rem" }}>No Confluence activity recorded yet.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
            <th style={{ padding: "0.5rem" }}>Tool</th>
            <th style={{ padding: "0.5rem" }}>Space</th>
            <th style={{ padding: "0.5rem" }}>Results</th>
            <th style={{ padding: "0.5rem" }}>Size</th>
            <th style={{ padding: "0.5rem" }}>Duration</th>
            <th style={{ padding: "0.5rem" }}>Status</th>
            <th style={{ padding: "0.5rem" }}>When</th>
          </tr>
        </thead>
        <tbody>
          {activity.map((a) => (
            <tr key={a.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td style={{ padding: "0.5rem" }}>
                <span style={{
                  padding: "0.15rem 0.4rem",
                  borderRadius: "0.2rem",
                  fontSize: "0.7rem",
                  backgroundColor: "#f3f4f6",
                  fontWeight: 500,
                }}>
                  {TOOL_LABELS[a.toolName] ?? a.toolName}
                </span>
              </td>
              <td style={{ padding: "0.5rem", color: "#666" }}>{a.spaceKey ?? "-"}</td>
              <td style={{ padding: "0.5rem" }}>{a.resultCount}</td>
              <td style={{ padding: "0.5rem", color: "#666" }}>{formatBytes(a.contentSizeBytes)}</td>
              <td style={{ padding: "0.5rem" }}>{formatDuration(a.durationMs)}</td>
              <td style={{ padding: "0.5rem" }}>
                {a.success ? (
                  <span style={{ color: "#10b981", fontWeight: 600 }}>OK</span>
                ) : (
                  <span style={{ color: "#ef4444", fontWeight: 600 }}>{a.errorTag ?? "Error"}</span>
                )}
              </td>
              <td style={{ padding: "0.5rem", color: "#888" }}>{timeAgo(a.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Recent Errors ────────────────────────────────────────────────────

function RecentErrors({ errors }: { errors: Array<{ toolName: string; errorTag: string; createdAt: string }> }) {
  if (errors.length === 0) return null;

  return (
    <div style={{ padding: "1rem", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "0.5rem" }}>
      <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "0.875rem", color: "#991b1b" }}>Recent Errors</h4>
      {errors.map((e, i) => (
        <div key={i} style={{ fontSize: "0.8rem", marginBottom: "0.25rem", color: "#7f1d1d" }}>
          <span style={{ fontWeight: 500 }}>{TOOL_LABELS[e.toolName] ?? e.toolName}</span>
          {" — "}
          <span>{e.errorTag}</span>
          <span style={{ color: "#999", marginLeft: "0.5rem" }}>{timeAgo(e.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export function ConfluencePage() {
  const { data: insights, isLoading: insightsLoading, error: insightsError } = useConfluenceInsights();
  const { data: activity, isLoading: activityLoading } = useConfluenceActivity(50);
  const [showActivity, setShowActivity] = useState(false);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Confluence</h1>
      <p style={{ color: "#666", fontSize: "0.875rem", marginBottom: "2rem" }}>
        Read-only Confluence integration using existing Jira credentials. Search pages, retrieve content as Markdown, and list spaces.
      </p>

      {/* Settings */}
      <SpaceAllowlistForm />

      {/* Insights Dashboard */}
      <h2 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Insights Dashboard</h2>

      {insightsLoading && <LoadingSpinner message="Loading insights..." />}
      {insightsError && <ErrorDisplay error={insightsError} message="Failed to load insights" />}

      {insights && (
        <>
          {/* Stat Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
            <StatCard label="Total Calls" value={insights.totalCalls} color="#3b82f6" />
            <StatCard label="Successful" value={insights.successfulCalls} color="#10b981" />
            <StatCard label="Failed" value={insights.failedCalls} color="#ef4444" />
            <StatCard label="Total Data" value={formatBytes(insights.totalContentBytes)} color="#8b5cf6" />
            <StatCard label="Results Returned" value={insights.totalResultsReturned} color="#f59e0b" />
            <StatCard label="Avg Latency" value={formatDuration(insights.avgDurationMs)} color="#06b6d4" />
          </div>

          {/* Breakdowns */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
            <ToolBreakdown callsByTool={insights.callsByTool} />
            <SpaceBreakdown callsBySpace={insights.callsBySpace} />
          </div>

          {/* Errors */}
          <RecentErrors errors={insights.recentErrors} />
        </>
      )}

      {/* Activity Log */}
      <div style={{ marginTop: "2rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 style={{ fontSize: "1.25rem", margin: 0 }}>Activity Log</h2>
          <button
            onClick={() => setShowActivity(!showActivity)}
            style={{
              padding: "0.375rem 0.75rem",
              backgroundColor: showActivity ? "#6b7280" : "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            {showActivity ? "Hide" : "Show"} Activity
          </button>
        </div>

        {showActivity && (
          <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem" }}>
            {activityLoading && <LoadingSpinner message="Loading activity..." />}
            {activity && <ActivityTable activity={activity} />}
          </div>
        )}
      </div>
    </div>
  );
}
