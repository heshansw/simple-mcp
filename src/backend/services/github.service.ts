import type { Logger } from "pino";
import {
  type Result,
  err,
  ok,
  integrationError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";

const GITHUB_API_BASE = "https://api.github.com";

export interface GitHubDependencies {
  logger: Logger;
  getToken: () => Promise<string | null>;
}

export type GitHubPullRequest = {
  number: number;
  title: string;
  state: string;
  user: { login: string };
  html_url: string;
  created_at: string;
  updated_at: string;
  head: { ref: string; sha: string };
  base: { ref: string };
  body: string | null;
  draft: boolean;
  changed_files?: number;
  additions?: number;
  deletions?: number;
};

export type GitHubPRFile = {
  sha: string;
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
};

export type GitHubReview = {
  id: number;
  state: string;
  html_url: string;
  submitted_at: string;
};

export interface GitHubListPullRequestsParams {
  owner: string;
  repo: string;
  state?: "open" | "closed" | "all";
}

export type GitHubReviewComment = {
  path: string;
  position: number;
  body: string;
};

export interface GitHubReviewPullRequestParams {
  owner: string;
  repo: string;
  prNumber: number;
  body: string;
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
  /** Optional inline comments on specific lines */
  comments?: GitHubReviewComment[] | undefined;
}

export type GitHubCreatePullRequestParams = {
  owner: string;
  repo: string;
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
};

export interface GitHubSearchCodeParams {
  query: string;
}

export interface GitHubService {
  listPullRequests(
    params: GitHubListPullRequestsParams
  ): Promise<Result<GitHubPullRequest[], DomainError>>;

  getPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<GitHubPullRequest, DomainError>>;

  getPullRequestFiles(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<Result<GitHubPRFile[], DomainError>>;

  reviewPullRequest(
    params: GitHubReviewPullRequestParams
  ): Promise<Result<GitHubReview, DomainError>>;

  createPullRequest(
    params: GitHubCreatePullRequestParams
  ): Promise<Result<GitHubPullRequest, DomainError>>;

  searchCode(
    params: GitHubSearchCodeParams
  ): Promise<Result<unknown, DomainError>>;

  /** Get the authenticated user's info */
  getAuthenticatedUser(): Promise<Result<{ login: string; name: string | null; avatar_url: string }, DomainError>>;

  /** List PRs assigned to the authenticated user across repos */
  getMyAssignedPRs(): Promise<Result<GitHubPullRequest[], DomainError>>;

  /** List PRs where the authenticated user's review is requested */
  getMyReviewRequests(): Promise<Result<GitHubPullRequest[], DomainError>>;

  /** List PRs created by the authenticated user */
  getMyCreatedPRs(): Promise<Result<GitHubPullRequest[], DomainError>>;
}

async function githubFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${GITHUB_API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...((options.headers as Record<string, string>) ?? {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(
      `GitHub API ${response.status}: ${response.statusText} — ${errorBody}`
    );
  }

  return (await response.json()) as T;
}

export function createGitHubService(
  deps: GitHubDependencies
): GitHubService {
  const { logger, getToken } = deps;

  async function resolveToken(): Promise<string> {
    const token = await getToken();
    if (!token) {
      throw new Error(
        "No GitHub access token configured. Add a token in Connections > GitHub > Credentials."
      );
    }
    return token;
  }

  return {
    async listPullRequests(
      params: GitHubListPullRequestsParams
    ): Promise<Result<GitHubPullRequest[], DomainError>> {
      try {
        const token = await resolveToken();
        const state = params.state ?? "open";
        logger.info(
          { owner: params.owner, repo: params.repo, state },
          "Listing GitHub pull requests"
        );

        const prs = await githubFetch<GitHubPullRequest[]>(
          `/repos/${params.owner}/${params.repo}/pulls?state=${state}&per_page=30`,
          token
        );

        logger.info(
          { count: prs.length },
          "Pull requests retrieved"
        );
        return ok(prs);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg, params }, "Failed to list pull requests");
        return err(integrationError("github", msg));
      }
    },

    async getPullRequest(
      owner: string,
      repo: string,
      prNumber: number
    ): Promise<Result<GitHubPullRequest, DomainError>> {
      try {
        const token = await resolveToken();
        logger.info({ owner, repo, prNumber }, "Fetching PR details");

        const pr = await githubFetch<GitHubPullRequest>(
          `/repos/${owner}/${repo}/pulls/${prNumber}`,
          token
        );

        return ok(pr);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg }, "Failed to fetch PR");
        return err(integrationError("github", msg));
      }
    },

    async getPullRequestFiles(
      owner: string,
      repo: string,
      prNumber: number
    ): Promise<Result<GitHubPRFile[], DomainError>> {
      try {
        const token = await resolveToken();
        logger.info({ owner, repo, prNumber }, "Fetching PR files");

        const files = await githubFetch<GitHubPRFile[]>(
          `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
          token
        );

        return ok(files);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg }, "Failed to fetch PR files");
        return err(integrationError("github", msg));
      }
    },

    async reviewPullRequest(
      params: GitHubReviewPullRequestParams
    ): Promise<Result<GitHubReview, DomainError>> {
      try {
        const token = await resolveToken();
        logger.info(
          {
            owner: params.owner,
            repo: params.repo,
            prNumber: params.prNumber,
            event: params.event,
          },
          "Submitting PR review"
        );

        const reviewPayload: Record<string, unknown> = {
          body: params.body,
          event: params.event,
        };

        if (params.comments && params.comments.length > 0) {
          reviewPayload.comments = params.comments.map((c) => ({
            path: c.path,
            position: c.position,
            body: c.body,
          }));
        }

        const review = await githubFetch<GitHubReview>(
          `/repos/${params.owner}/${params.repo}/pulls/${params.prNumber}/reviews`,
          token,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(reviewPayload),
          }
        );

        logger.info(
          { reviewId: review.id, state: review.state },
          "PR review submitted"
        );
        return ok(review);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg, params }, "Failed to submit PR review");
        return err(integrationError("github", msg));
      }
    },

    async createPullRequest(
      params: GitHubCreatePullRequestParams
    ): Promise<Result<GitHubPullRequest, DomainError>> {
      try {
        const token = await resolveToken();
        logger.info(
          {
            owner: params.owner,
            repo: params.repo,
            head: params.head,
            base: params.base,
          },
          "Creating pull request"
        );

        const pr = await githubFetch<GitHubPullRequest>(
          `/repos/${params.owner}/${params.repo}/pulls`,
          token,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: params.title,
              head: params.head,
              base: params.base,
              body: params.body ?? "",
              draft: params.draft ?? false,
            }),
          }
        );

        logger.info(
          { prNumber: pr.number, url: pr.html_url },
          "Pull request created"
        );
        return ok(pr);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg, params }, "Failed to create pull request");
        return err(integrationError("github", msg));
      }
    },

    async searchCode(
      params: GitHubSearchCodeParams
    ): Promise<Result<unknown, DomainError>> {
      try {
        const token = await resolveToken();
        logger.info({ query: params.query }, "Searching GitHub code");

        const results = await githubFetch<unknown>(
          `/search/code?q=${encodeURIComponent(params.query)}&per_page=30`,
          token
        );

        return ok(results);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg, params }, "Failed to search code");
        return err(integrationError("github", msg));
      }
    },

    async getAuthenticatedUser(): Promise<Result<{ login: string; name: string | null; avatar_url: string }, DomainError>> {
      try {
        const token = await resolveToken();
        const user = await githubFetch<{ login: string; name: string | null; avatar_url: string }>(
          "/user",
          token
        );
        return ok(user);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg }, "Failed to get authenticated user");
        return err(integrationError("github", msg));
      }
    },

    async getMyAssignedPRs(): Promise<Result<GitHubPullRequest[], DomainError>> {
      try {
        const token = await resolveToken();

        // First get the authenticated user's login
        const userResult = await githubFetch<{ login: string }>("/user", token);

        logger.info({ user: userResult.login }, "Fetching PRs assigned to me");

        // Use the search API to find PRs assigned to the user
        const searchResult = await githubFetch<{ items: GitHubPullRequest[] }>(
          `/search/issues?q=${encodeURIComponent(`is:pr is:open assignee:${userResult.login}`)}&per_page=50&sort=updated&order=desc`,
          token
        );

        return ok(searchResult.items);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg }, "Failed to fetch assigned PRs");
        return err(integrationError("github", msg));
      }
    },

    async getMyReviewRequests(): Promise<Result<GitHubPullRequest[], DomainError>> {
      try {
        const token = await resolveToken();

        const userResult = await githubFetch<{ login: string }>("/user", token);

        logger.info({ user: userResult.login }, "Fetching PRs needing my review");

        // Search for PRs where review is requested from the user
        const searchResult = await githubFetch<{ items: GitHubPullRequest[] }>(
          `/search/issues?q=${encodeURIComponent(`is:pr is:open review-requested:${userResult.login}`)}&per_page=50&sort=updated&order=desc`,
          token
        );

        return ok(searchResult.items);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg }, "Failed to fetch review requests");
        return err(integrationError("github", msg));
      }
    },

    async getMyCreatedPRs(): Promise<Result<GitHubPullRequest[], DomainError>> {
      try {
        const token = await resolveToken();

        const userResult = await githubFetch<{ login: string }>("/user", token);

        logger.info({ user: userResult.login }, "Fetching PRs created by me");

        const searchResult = await githubFetch<{ items: GitHubPullRequest[] }>(
          `/search/issues?q=${encodeURIComponent(`is:pr is:open author:${userResult.login}`)}&per_page=50&sort=updated&order=desc`,
          token
        );

        return ok(searchResult.items);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error({ error: msg }, "Failed to fetch created PRs");
        return err(integrationError("github", msg));
      }
    },
  };
}
