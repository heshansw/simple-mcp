import { useQuery } from "@tanstack/react-query";
import { LoadingSpinner } from "@frontend/components/loading-spinner";
import { ErrorDisplay } from "@frontend/components/error-display";

// ── Types ────────────────────────────────────────────────────────────────────

type Review = {
  id: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  verdict: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  inlineCommentCount: number;
  reviewBody: string;
  githubReviewId: number | null;
  githubReviewUrl: string | null;
  inputTokensEstimate: number | null;
  outputTokensEstimate: number | null;
  createdAt: string;
};

type ReviewStats = {
  totalReviews: number;
  approvals: number;
  changesRequested: number;
  comments: number;
  totalInlineComments: number;
  totalInputTokensEstimate: number;
  totalOutputTokensEstimate: number;
  reviewsByRepo: Array<{ repo: string; owner: string; count: number }>;
};

// ── API hooks ────────────────────────────────────────────────────────────────

function useReviews() {
  return useQuery<Review[]>({
    queryKey: ["reviews"],
    queryFn: async () => {
      const res = await fetch("/api/reviews?limit=200");
      if (!res.ok) throw new Error("Failed to fetch reviews");
      return res.json() as Promise<Review[]>;
    },
    refetchInterval: 30_000,
  });
}

function useReviewStats() {
  return useQuery<ReviewStats>({
    queryKey: ["reviews", "stats"],
    queryFn: async () => {
      const res = await fetch("/api/reviews/stats");
      if (!res.ok) throw new Error("Failed to fetch review stats");
      return res.json() as Promise<ReviewStats>;
    },
    refetchInterval: 30_000,
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function verdictColor(verdict: Review["verdict"]): string {
  if (verdict === "APPROVE") return "#16a34a";
  if (verdict === "REQUEST_CHANGES") return "#dc2626";
  return "#2563eb";
}

function verdictLabel(verdict: Review["verdict"]): string {
  if (verdict === "APPROVE") return "✓ Approved";
  if (verdict === "REQUEST_CHANGES") return "✗ Changes Requested";
  return "● Commented";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function fmtTokens(n: number | null): string {
  if (n == null || n === 0) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color = "#1f2937",
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        backgroundColor: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: "0.5rem",
        padding: "1.25rem 1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
      }}
    >
      <span style={{ fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </span>
      <span style={{ fontSize: "1.75rem", fontWeight: "700", color, lineHeight: 1 }}>
        {value}
      </span>
      {sub && <span style={{ fontSize: "0.75rem", color: "#9ca3af" }}>{sub}</span>}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: Review["verdict"] }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.2rem 0.6rem",
        borderRadius: "999px",
        fontSize: "0.75rem",
        fontWeight: "600",
        color: "#fff",
        backgroundColor: verdictColor(verdict),
        whiteSpace: "nowrap",
      }}
    >
      {verdictLabel(verdict)}
    </span>
  );
}

function ReviewRow({ review }: { review: Review }) {
  const totalTokens =
    (review.inputTokensEstimate ?? 0) + (review.outputTokensEstimate ?? 0);

  return (
    <tr
      style={{
        borderBottom: "1px solid #f3f4f6",
        verticalAlign: "middle",
      }}
    >
      <td style={{ padding: "0.875rem 1rem", fontWeight: "600", color: "#111827" }}>
        {review.githubReviewUrl ? (
          <a
            href={review.githubReviewUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#2563eb", textDecoration: "none" }}
          >
            #{review.prNumber}
          </a>
        ) : (
          `#${review.prNumber}`
        )}
      </td>
      <td style={{ padding: "0.875rem 1rem", color: "#374151", maxWidth: "280px" }}>
        <div style={{ fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {review.prTitle || "(no title)"}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: "0.125rem" }}>
          {review.owner}/{review.repo}
        </div>
      </td>
      <td style={{ padding: "0.875rem 1rem" }}>
        <VerdictBadge verdict={review.verdict} />
      </td>
      <td style={{ padding: "0.875rem 1rem", textAlign: "center", color: "#374151" }}>
        {review.inlineCommentCount > 0 ? (
          <span style={{ fontWeight: "600", color: "#7c3aed" }}>{review.inlineCommentCount}</span>
        ) : (
          <span style={{ color: "#d1d5db" }}>—</span>
        )}
      </td>
      <td style={{ padding: "0.875rem 1rem", textAlign: "right", color: "#6b7280", fontSize: "0.875rem" }}>
        {fmtTokens(totalTokens > 0 ? totalTokens : null)}
      </td>
      <td style={{ padding: "0.875rem 1rem", color: "#9ca3af", fontSize: "0.8rem", whiteSpace: "nowrap" }}>
        {formatDate(review.createdAt)}
      </td>
    </tr>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ReviewsPage() {
  const { data: reviews, isLoading: reviewsLoading, error: reviewsError } = useReviews();
  const { data: stats, isLoading: statsLoading } = useReviewStats();

  if (reviewsLoading || statsLoading) {
    return <LoadingSpinner message="Loading review insights..." />;
  }

  if (reviewsError) {
    return <ErrorDisplay error={reviewsError} message="Failed to load reviews" />;
  }

  const totalTokens =
    (stats?.totalInputTokensEstimate ?? 0) + (stats?.totalOutputTokensEstimate ?? 0);

  return (
    <div>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ margin: "0 0 0.375rem 0", fontSize: "1.5rem", fontWeight: "700" }}>
          Review Insights
        </h1>
        <p style={{ margin: 0, color: "#6b7280", fontSize: "0.875rem" }}>
          All PR reviews submitted via Claude through MCP tools.
        </p>
      </div>

      {/* Stats row */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: "1rem",
            marginBottom: "2rem",
          }}
        >
          <StatCard label="Total Reviews" value={stats.totalReviews} />
          <StatCard label="Approved" value={stats.approvals} color="#16a34a" />
          <StatCard label="Changes Requested" value={stats.changesRequested} color="#dc2626" />
          <StatCard label="Commented" value={stats.comments} color="#2563eb" />
          <StatCard
            label="Inline Comments"
            value={stats.totalInlineComments}
            color="#7c3aed"
          />
          <StatCard
            label="Tokens Used (est.)"
            value={fmtTokens(totalTokens)}
            sub={`in: ${fmtTokens(stats.totalInputTokensEstimate)} · out: ${fmtTokens(stats.totalOutputTokensEstimate)}`}
            color="#0f766e"
          />
        </div>
      )}

      {/* Reviews by repo */}
      {stats && stats.reviewsByRepo.length > 0 && (
        <div
          style={{
            backgroundColor: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: "0.5rem",
            padding: "1.25rem 1.5rem",
            marginBottom: "2rem",
          }}
        >
          <h2 style={{ margin: "0 0 1rem 0", fontSize: "1rem", fontWeight: "600" }}>
            By Repository
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {stats.reviewsByRepo.map((r) => (
              <span
                key={`${r.owner}/${r.repo}`}
                style={{
                  padding: "0.3rem 0.75rem",
                  backgroundColor: "#f3f4f6",
                  borderRadius: "999px",
                  fontSize: "0.8rem",
                  fontWeight: "500",
                  color: "#374151",
                }}
              >
                {r.owner}/{r.repo}
                <span
                  style={{
                    marginLeft: "0.4rem",
                    backgroundColor: "#1f2937",
                    color: "#fff",
                    borderRadius: "999px",
                    padding: "0.05rem 0.4rem",
                    fontSize: "0.7rem",
                    fontWeight: "700",
                  }}
                >
                  {r.count}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Review history table */}
      <div
        style={{
          backgroundColor: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "0.5rem",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "1rem 1.5rem",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: "600" }}>Review History</h2>
          <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
            {reviews?.length ?? 0} review{reviews?.length !== 1 ? "s" : ""}
          </span>
        </div>

        {!reviews || reviews.length === 0 ? (
          <div
            style={{
              padding: "3rem 2rem",
              textAlign: "center",
              color: "#9ca3af",
            }}
          >
            <p style={{ margin: "0 0 0.5rem 0", fontSize: "1rem" }}>No reviews yet</p>
            <p style={{ margin: 0, fontSize: "0.875rem" }}>
              Ask Claude to review a PR using the{" "}
              <code
                style={{
                  backgroundColor: "#f3f4f6",
                  padding: "0.1rem 0.4rem",
                  borderRadius: "0.25rem",
                  fontFamily: "monospace",
                }}
              >
                github_get_pr_diff
              </code>{" "}
              and{" "}
              <code
                style={{
                  backgroundColor: "#f3f4f6",
                  padding: "0.1rem 0.4rem",
                  borderRadius: "0.25rem",
                  fontFamily: "monospace",
                }}
              >
                github_submit_review
              </code>{" "}
              tools.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1px solid #e5e7eb" }}>
                  {["PR", "Title / Repo", "Verdict", "Comments", "Tokens", "Reviewed At"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          padding: "0.625rem 1rem",
                          textAlign: h === "Comments" || h === "Tokens" ? "center" : "left",
                          fontSize: "0.75rem",
                          fontWeight: "600",
                          color: "#6b7280",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <ReviewRow key={r.id} review={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
