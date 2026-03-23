import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@frontend/api/client";
import { reviewKeys } from "@frontend/api/query-keys";

export type Review = {
  id: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  status: "in_progress" | "completed";
  verdict: "" | "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  inlineCommentCount: number;
  reviewBody: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  githubReviewId: number | null;
  githubReviewUrl: string | null;
  inputTokensEstimate: number | null;
  outputTokensEstimate: number | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
};

export type ReviewStats = {
  totalReviews: number;
  completedReviews: number;
  inProgressReviews: number;
  approvals: number;
  changesRequested: number;
  comments: number;
  totalInlineComments: number;
  totalInputTokensEstimate: number;
  totalOutputTokensEstimate: number;
  totalFilesChanged: number;
  totalAdditions: number;
  totalDeletions: number;
  avgDurationMs: number | null;
  reviewsByRepo: Array<{ repo: string; owner: string; count: number }>;
};

export function useReviews(limit = 500) {
  return useQuery<Review[]>({
    queryKey: reviewKeys.list(),
    queryFn: () => apiClient.get<Review[]>(`/reviews?limit=${limit}`),
    refetchInterval: 15_000,
  });
}

export function useReviewStats() {
  return useQuery<ReviewStats>({
    queryKey: reviewKeys.stats(),
    queryFn: () => apiClient.get<ReviewStats>("/reviews/stats"),
    refetchInterval: 15_000,
  });
}

export function useInProgressReviews() {
  return useQuery<Review[]>({
    queryKey: [...reviewKeys.all, "in-progress"] as const,
    queryFn: () => apiClient.get<Review[]>("/reviews/in-progress"),
    refetchInterval: 5_000, // Poll faster for in-progress
  });
}
