import { useMyPRDashboard } from "@frontend/api/github.api";
import type { GitHubPR } from "@frontend/api/github.api";
import { useReviews, useReviewStats, useInProgressReviews } from "@frontend/api/reviews.api";
import type { Review } from "@frontend/api/reviews.api";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractRepoInfo(pr: GitHubPR): { owner: string; repo: string } | null {
  if (pr.repository_url) {
    const parts = pr.repository_url.split("/");
    const repo = parts[parts.length - 1];
    const owner = parts[parts.length - 2];
    if (owner && repo) return { owner, repo };
  }
  if (pr.html_url) {
    const match = pr.html_url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (match) return { owner: match[1]!, repo: match[2]! };
  }
  return null;
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function verdictColor(verdict: string): string {
  if (verdict === "APPROVE") return "#16a34a";
  if (verdict === "REQUEST_CHANGES") return "#dc2626";
  return "#2563eb";
}

function verdictLabel(verdict: string): string {
  if (verdict === "APPROVE") return "Approved";
  if (verdict === "REQUEST_CHANGES") return "Changes Requested";
  return "Commented";
}

function fmtTokens(n: number): string {
  if (n === 0) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

/** Find the most recent review matching this PR */
function findReviewForPR(
  pr: GitHubPR,
  reviews: Review[]
): Review | undefined {
  const info = extractRepoInfo(pr);
  if (!info) return undefined;
  return reviews.find(
    (r) => r.owner === info.owner && r.repo === info.repo && r.prNumber === pr.number
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ReviewBadge({ review }: { review: Review | undefined }) {
  if (!review) {
    return (
      <span style={{ display: "inline-block", padding: "0.2rem 0.55rem", borderRadius: "999px", fontSize: "0.7rem", fontWeight: "600", color: "#9ca3af", backgroundColor: "#f3f4f6", border: "1px solid #e5e7eb" }}>
        Not Reviewed
      </span>
    );
  }

  if (review.status === "in_progress") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", padding: "0.2rem 0.55rem", borderRadius: "999px", fontSize: "0.7rem", fontWeight: "600", color: "#fff", backgroundColor: "#f59e0b" }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#fff", display: "inline-block", animation: "pulse 1.5s ease-in-out infinite" }} />
        Analyzing...
      </span>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.2rem 0.55rem",
        borderRadius: "999px",
        fontSize: "0.7rem",
        fontWeight: "600",
        color: "#fff",
        backgroundColor: verdictColor(review.verdict),
      }}
    >
      {verdictLabel(review.verdict)}
      {review.inlineCommentCount > 0 && (
        <span
          style={{
            backgroundColor: "rgba(255,255,255,0.3)",
            borderRadius: "999px",
            padding: "0 0.3rem",
            fontSize: "0.65rem",
          }}
        >
          {review.inlineCommentCount}
        </span>
      )}
    </span>
  );
}

function PRCard({
  pr,
  review,
}: {
  pr: GitHubPR;
  review: Review | undefined;
}) {
  const repoInfo = extractRepoInfo(pr);
  const repoLabel = repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : "";
  const prUrl = pr.pull_request?.html_url || pr.html_url;
  const updatedAgo = getTimeAgo(pr.updated_at);
  const tokens =
    review
      ? (review.inputTokensEstimate ?? 0) + (review.outputTokensEstimate ?? 0)
      : 0;

  return (
    <div
      style={{
        padding: "1rem 1.25rem",
        backgroundColor: "#fff",
        borderRadius: "0.375rem",
        border: `1px solid ${review ? (review.status === "in_progress" ? "#fde68a" : "#d1fae5") : "#e5e7eb"}`,
        borderLeft: review ? `3px solid ${review.status === "in_progress" ? "#f59e0b" : verdictColor(review.verdict)}` : "1px solid #e5e7eb",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: "1rem",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem", flexWrap: "wrap" }}>
          {pr.draft && (
            <span
              style={{
                fontSize: "0.7rem",
                padding: "0.1rem 0.4rem",
                backgroundColor: "#6b7280",
                color: "#fff",
                borderRadius: "0.25rem",
                fontWeight: "600",
              }}
            >
              DRAFT
            </span>
          )}
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: "#1f2937",
              textDecoration: "none",
              fontWeight: "600",
              fontSize: "0.95rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            #{pr.number} {pr.title}
          </a>
          <ReviewBadge review={review} />
        </div>
        <div style={{ fontSize: "0.8rem", color: "#6b7280", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {repoLabel && <span style={{ fontWeight: "500" }}>{repoLabel}</span>}
          <span>by {pr.user.login}</span>
          <span>updated {updatedAgo}</span>
          {pr.head && pr.base && (
            <span style={{ color: "#9ca3af" }}>
              {pr.head.ref} → {pr.base.ref}
            </span>
          )}
          {review && tokens > 0 && (
            <span style={{ color: "#0f766e", fontWeight: "500" }}>
              ~{fmtTokens(tokens)} tokens
            </span>
          )}
          {review && (
            <span style={{ color: "#9ca3af" }}>
              reviewed {getTimeAgo(review.createdAt)}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexShrink: 0 }}>
        {review?.githubReviewUrl && (
          <a
            href={review.githubReviewUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: "0.4rem 0.75rem",
              backgroundColor: "#8b5cf6",
              color: "#fff",
              borderRadius: "0.375rem",
              fontSize: "0.8rem",
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            Review
          </a>
        )}
        <a
          href={prUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            padding: "0.4rem 0.75rem",
            backgroundColor: "#e5e7eb",
            color: "#374151",
            borderRadius: "0.375rem",
            fontSize: "0.8rem",
            textDecoration: "none",
            whiteSpace: "nowrap",
          }}
        >
          View
        </a>
      </div>
    </div>
  );
}

function StatPill({ label, value, color = "#1f2937" }: { label: string; value: string | number; color?: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "0.75rem 1.25rem",
        backgroundColor: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "0.5rem",
        minWidth: "100px",
      }}
    >
      <span style={{ fontSize: "1.5rem", fontWeight: "700", color, lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: "0.25rem", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
    </div>
  );
}

function PRSection({
  title,
  count,
  color,
  prs,
  reviews,
}: {
  title: string;
  count: number;
  color: string;
  prs: GitHubPR[];
  reviews: Review[];
}) {
  const reviewedCount = prs.filter((pr) => findReviewForPR(pr, reviews) !== undefined).length;

  return (
    <div style={{ marginBottom: "2rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: "600" }}>{title}</h2>
        <span
          style={{
            backgroundColor: color,
            color: "#fff",
            padding: "0.15rem 0.6rem",
            borderRadius: "999px",
            fontSize: "0.8rem",
            fontWeight: "600",
          }}
        >
          {count}
        </span>
        {prs.length > 0 && (
          <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
            {reviewedCount}/{prs.length} reviewed
          </span>
        )}
      </div>
      {prs.length === 0 ? (
        <div
          style={{
            padding: "1.25rem",
            backgroundColor: "#fff",
            borderRadius: "0.375rem",
            border: "1px solid #e5e7eb",
            color: "#9ca3af",
            textAlign: "center",
            fontSize: "0.875rem",
          }}
        >
          No pull requests
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {prs.map((pr) => (
            <PRCard
              key={`${pr.html_url}-${pr.number}`}
              pr={pr}
              review={findReviewForPR(pr, reviews)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function MyPRsPage() {
  const { data, isLoading, error, refetch } = useMyPRDashboard();
  const { data: reviews } = useReviews();
  const { data: inProgress } = useInProgressReviews();
  const { data: stats } = useReviewStats();

  if (isLoading) {
    return <LoadingSpinner message="Loading your pull requests..." />;
  }

  if (error) {
    return (
      <div>
        <h1 style={{ marginTop: 0, marginBottom: "1rem" }}>My Pull Requests</h1>
        <ErrorDisplay error={error} message="Failed to load pull requests. Make sure you have a connected GitHub connection with an access token." />
      </div>
    );
  }

  const { user, assigned, reviewRequested, created } = data ?? {
    user: null,
    assigned: [],
    reviewRequested: [],
    created: [],
  };

  // Merge completed + in-progress reviews for PR-level lookup
  const allReviews = [...(reviews ?? []), ...(inProgress ?? [])];
  const totalTokens = stats
    ? (stats.totalInputTokensEstimate ?? 0) + (stats.totalOutputTokensEstimate ?? 0)
    : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ margin: 0 }}>My Pull Requests</h1>
          {user && (
            <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#6b7280" }}>
              Signed in as <strong>{user.login}</strong>
              {user.name ? ` (${user.name})` : ""}
            </p>
          )}
        </div>
        <button
          onClick={() => refetch()}
          style={{
            padding: "0.5rem 1rem",
            backgroundColor: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "0.375rem",
            fontSize: "0.875rem",
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
      </div>

      {/* Insights strip */}
      {stats && stats.totalReviews > 0 && (
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            marginBottom: "2rem",
            flexWrap: "wrap",
          }}
        >
          <StatPill label="Completed" value={stats.completedReviews} />
          {stats.inProgressReviews > 0 && <StatPill label="In Progress" value={stats.inProgressReviews} color="#f59e0b" />}
          <StatPill label="Approved" value={stats.approvals} color="#16a34a" />
          <StatPill label="Changes" value={stats.changesRequested} color="#dc2626" />
          <StatPill label="Comments" value={stats.comments} color="#2563eb" />
          <StatPill label="Inline" value={stats.totalInlineComments} color="#7c3aed" />
          <StatPill label="Tokens" value={fmtTokens(totalTokens)} color="#0f766e" />
        </div>
      )}

      {/* PR sections */}
      <PRSection
        title="Review Requested"
        count={reviewRequested.length}
        color="#f59e0b"
        prs={reviewRequested}
        reviews={allReviews}
      />

      <PRSection
        title="Assigned to Me"
        count={assigned.length}
        color="#3b82f6"
        prs={assigned}
        reviews={allReviews}
      />

      <PRSection
        title="Created by Me"
        count={created.length}
        color="#10b981"
        prs={created}
        reviews={allReviews}
      />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
