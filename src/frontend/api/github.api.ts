import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@frontend/api/client";
import { githubKeys } from "@frontend/api/query-keys";

export type GitHubUser = {
  login: string;
  name: string | null;
  avatar_url: string;
};

export type GitHubPR = {
  number: number;
  title: string;
  state: string;
  user: { login: string; avatar_url?: string };
  html_url: string;
  pull_request?: { html_url: string };
  created_at: string;
  updated_at: string;
  head?: { ref: string };
  base?: { ref: string };
  body: string | null;
  draft?: boolean;
  repository_url?: string;
};

export type PRDashboard = {
  user: GitHubUser | null;
  assigned: GitHubPR[];
  reviewRequested: GitHubPR[];
  created: GitHubPR[];
};

export function useGitHubUser() {
  return useQuery({
    queryKey: githubKeys.me(),
    queryFn: () => apiClient.get<GitHubUser>("/github/me"),
    retry: false,
  });
}

export function useMyPRDashboard() {
  return useQuery({
    queryKey: githubKeys.dashboard(),
    queryFn: () => apiClient.get<PRDashboard>("/github/me/dashboard"),
    refetchInterval: 60_000, // Refresh every minute
    retry: false,
  });
}

export function useMyAssignedPRs() {
  return useQuery({
    queryKey: githubKeys.assigned(),
    queryFn: () => apiClient.get<GitHubPR[]>("/github/me/assigned"),
    retry: false,
  });
}

export function useMyReviewRequests() {
  return useQuery({
    queryKey: githubKeys.reviewRequested(),
    queryFn: () => apiClient.get<GitHubPR[]>("/github/me/review-requested"),
    retry: false,
  });
}

export function useMyCreatedPRs() {
  return useQuery({
    queryKey: githubKeys.created(),
    queryFn: () => apiClient.get<GitHubPR[]>("/github/me/created"),
    retry: false,
  });
}

