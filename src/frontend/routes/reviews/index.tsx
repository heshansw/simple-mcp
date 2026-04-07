import { useReviews, useReviewStats, useInProgressReviews } from "@frontend/api/reviews.api";
import type { Review } from "@frontend/api/reviews.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";
import {
  REVIEWS_EMPTY_STATE_PREFIX,
  REVIEWS_PAGE_DESCRIPTION,
} from "@shared/mcp-client.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function verdictColor(verdict: string): string {
  if (verdict === "APPROVE") return "#16a34a";
  if (verdict === "REQUEST_CHANGES") return "#dc2626";
  if (verdict === "COMMENT") return "#2563eb";
  return "#9ca3af";
}

function verdictLabel(verdict: string): string {
  if (verdict === "APPROVE") return "Approved";
  if (verdict === "REQUEST_CHANGES") return "Changes Requested";
  if (verdict === "COMMENT") return "Commented";
  return "—";
}


function fmtTokens(n: number): string {
  if (n === 0) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  return `${Math.floor(secs / 60)}m ${Math.round(secs % 60)}s`;
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = "#1f2937" }: { label: string; value: string | number; sub?: string; color?: string }) {
  return (
    <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
      <span style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</span>
      <span style={{ fontSize: "1.5rem", fontWeight: "700", color, lineHeight: 1 }}>{value}</span>
      {sub && <span style={{ fontSize: "0.7rem", color: "#9ca3af" }}>{sub}</span>}
    </div>
  );
}

function InProgressCard({ review }: { review: Review }) {
  const elapsed = Date.now() - new Date(review.startedAt).getTime();
  return (
    <div style={{ padding: "0.875rem 1.25rem", backgroundColor: "#fffbeb", border: "1px solid #fde68a", borderRadius: "0.5rem", borderLeft: "3px solid #f59e0b", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.2rem" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#f59e0b", display: "inline-block", animation: "pulse 1.5s ease-in-out infinite" }} />
          <span style={{ fontWeight: "600", fontSize: "0.95rem" }}>
            #{review.prNumber} {review.prTitle}
          </span>
        </div>
        <div style={{ fontSize: "0.8rem", color: "#92400e", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <span>{review.owner}/{review.repo}</span>
          <span>by {review.prAuthor}</span>
          <span>{review.filesChanged} files · +{review.additions} -{review.deletions}</span>
          <span>analyzing for {fmtDuration(elapsed)}</span>
        </div>
      </div>
      <span style={{ padding: "0.25rem 0.6rem", borderRadius: "999px", fontSize: "0.7rem", fontWeight: "600", backgroundColor: "#f59e0b", color: "#fff", whiteSpace: "nowrap" }}>In Progress</span>
    </div>
  );
}

function ReviewRow({ review }: { review: Review }) {
  const totalTokens = (review.inputTokensEstimate ?? 0) + (review.outputTokensEstimate ?? 0);
  const duration =
    review.startedAt && review.completedAt
      ? new Date(review.completedAt).getTime() - new Date(review.startedAt).getTime()
      : null;

  return (
    <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
      <td style={{ padding: "0.75rem 1rem", fontWeight: "600" }}>
        {review.githubReviewUrl ? (
          <a href={review.githubReviewUrl} target="_blank" rel="noreferrer" style={{ color: "#2563eb", textDecoration: "none" }}>#{review.prNumber}</a>
        ) : `#${review.prNumber}`}
      </td>
      <td style={{ padding: "0.75rem 1rem", maxWidth: "250px" }}>
        <div style={{ fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {review.prTitle || "(no title)"}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.1rem" }}>
          {review.owner}/{review.repo} · by {review.prAuthor || "—"}
        </div>
      </td>
      <td style={{ padding: "0.75rem 1rem" }}>
        <span style={{ display: "inline-block", padding: "0.15rem 0.5rem", borderRadius: "999px", fontSize: "0.7rem", fontWeight: "600", color: "#fff", backgroundColor: verdictColor(review.verdict) }}>
          {verdictLabel(review.verdict)}
        </span>
      </td>
      <td style={{ padding: "0.75rem 1rem", textAlign: "center", fontSize: "0.85rem" }}>
        <span style={{ color: "#6b7280" }}>{review.filesChanged}</span>
        <span style={{ margin: "0 0.25rem", color: "#d1d5db" }}>·</span>
        <span style={{ color: "#16a34a" }}>+{review.additions}</span>
        <span style={{ margin: "0 0.15rem", color: "#d1d5db" }}>/</span>
        <span style={{ color: "#dc2626" }}>-{review.deletions}</span>
      </td>
      <td style={{ padding: "0.75rem 1rem", textAlign: "center" }}>
        {review.inlineCommentCount > 0 ? (
          <span style={{ fontWeight: "600", color: "#7c3aed" }}>{review.inlineCommentCount}</span>
        ) : <span style={{ color: "#d1d5db" }}>—</span>}
      </td>
      <td style={{ padding: "0.75rem 1rem", textAlign: "right", color: "#6b7280", fontSize: "0.85rem" }}>
        {totalTokens > 0 ? fmtTokens(totalTokens) : <span style={{ color: "#d1d5db" }}>—</span>}
      </td>
      <td style={{ padding: "0.75rem 1rem", textAlign: "right", color: "#6b7280", fontSize: "0.85rem" }}>
        {fmtDuration(duration)}
      </td>
      <td style={{ padding: "0.75rem 1rem", color: "#9ca3af", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
        {review.completedAt ? getTimeAgo(review.completedAt) : "—"}
      </td>
    </tr>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function ReviewsPage() {
  const { data: reviews, isLoading: rLoading, error: rError } = useReviews();
  const { data: stats, isLoading: sLoading } = useReviewStats();
  const { data: inProgress } = useInProgressReviews();

  if (rLoading || sLoading) return <LoadingSpinner message="Loading review insights..." />;
  if (rError) return <ErrorDisplay error={rError} message="Failed to load reviews" />;

  const completed = (reviews ?? []).filter((r) => r.status === "completed");
  const totalTokens = stats ? stats.totalInputTokensEstimate + stats.totalOutputTokensEstimate : 0;

  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ margin: "0 0 0.375rem 0", fontSize: "1.5rem", fontWeight: "700" }}>Review Insights</h1>
        <p style={{ margin: 0, color: "#6b7280", fontSize: "0.875rem" }}>{REVIEWS_PAGE_DESCRIPTION}</p>
      </div>

      {/* In-progress reviews */}
      {inProgress && inProgress.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <h2 style={{ margin: "0 0 0.75rem 0", fontSize: "1.1rem", fontWeight: "600", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            In Progress
            <span style={{ backgroundColor: "#f59e0b", color: "#fff", padding: "0.1rem 0.5rem", borderRadius: "999px", fontSize: "0.75rem", fontWeight: "700" }}>{inProgress.length}</span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {inProgress.map((r) => <InProgressCard key={r.id} review={r} />)}
          </div>
        </div>
      )}

      {/* Stats grid */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(145px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
          <StatCard label="Completed" value={stats.completedReviews} />
          <StatCard label="In Progress" value={stats.inProgressReviews} color="#f59e0b" />
          <StatCard label="Approved" value={stats.approvals} color="#16a34a" />
          <StatCard label="Changes" value={stats.changesRequested} color="#dc2626" />
          <StatCard label="Commented" value={stats.comments} color="#2563eb" />
          <StatCard label="Inline Comments" value={stats.totalInlineComments} color="#7c3aed" />
          <StatCard label="Files Reviewed" value={stats.totalFilesChanged} />
          <StatCard label="Lines Changed" value={`+${stats.totalAdditions} / -${stats.totalDeletions}`} sub={`${stats.totalAdditions + stats.totalDeletions} total`} />
          <StatCard label="Tokens (est.)" value={fmtTokens(totalTokens)} sub={`in: ${fmtTokens(stats.totalInputTokensEstimate)} · out: ${fmtTokens(stats.totalOutputTokensEstimate)}`} color="#0f766e" />
          <StatCard label="Avg Duration" value={fmtDuration(stats.avgDurationMs)} color="#6366f1" />
        </div>
      )}

      {/* By repo */}
      {stats && stats.reviewsByRepo.length > 0 && (
        <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1.25rem 1.5rem", marginBottom: "2rem" }}>
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1rem", fontWeight: "600" }}>By Repository</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {stats.reviewsByRepo.map((r) => (
              <span key={`${r.owner}/${r.repo}`} style={{ padding: "0.3rem 0.75rem", backgroundColor: "#f3f4f6", borderRadius: "999px", fontSize: "0.8rem", fontWeight: "500", color: "#374151" }}>
                {r.owner}/{r.repo}
                <span style={{ marginLeft: "0.4rem", backgroundColor: "#1f2937", color: "#fff", borderRadius: "999px", padding: "0.05rem 0.4rem", fontSize: "0.7rem", fontWeight: "700" }}>{r.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Review history table */}
      <div style={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: "0.5rem", overflow: "hidden" }}>
        <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: "600" }}>Completed Reviews</h2>
          <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>{completed.length} review{completed.length !== 1 ? "s" : ""}</span>
        </div>

        {completed.length === 0 ? (
          <div style={{ padding: "3rem 2rem", textAlign: "center", color: "#9ca3af" }}>
            <p style={{ margin: "0 0 0.5rem 0", fontSize: "1rem" }}>No completed reviews yet</p>
            <p style={{ margin: 0, fontSize: "0.875rem" }}>
              {REVIEWS_EMPTY_STATE_PREFIX}
              <code style={{ backgroundColor: "#f3f4f6", padding: "0.1rem 0.4rem", borderRadius: "0.25rem", fontFamily: "monospace" }}>github_get_pr_diff</code>
              {" then "}
              <code style={{ backgroundColor: "#f3f4f6", padding: "0.1rem 0.4rem", borderRadius: "0.25rem", fontFamily: "monospace" }}>github_submit_review</code>.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  {["PR", "Title / Repo", "Verdict", "Changes", "Comments", "Tokens", "Duration", "Completed"].map((h) => (
                    <th key={h} style={{ padding: "0.5rem 1rem", textAlign: ["Changes", "Comments", "Tokens", "Duration"].includes(h) ? "center" : (["Tokens", "Duration"].includes(h) ? "right" : "left"), fontSize: "0.7rem", fontWeight: "600", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {completed.map((r) => <ReviewRow key={r.id} review={r} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
