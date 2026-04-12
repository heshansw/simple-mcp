---
name: Multi-Agent PR Review Pipeline Requirements
description: Requirements document written 2026-04-12 for the cross-agent PR review pipeline feature — five new MCP tools orchestrating OpenAI and Claude reviews posted as GitHub inline comments
type: project
---

Requirements spec written and saved to `docs/ai/requirements/multi-agent-pr-review-pipeline.md` on 2026-04-12. Status: pending implementation.

**Scope:** Five new MCP tools (`github_create_pr_and_request_review`, `github_review_pr_with_openai`, `github_review_pr_with_claude`, `github_get_review_status`). One new service (`openai-review.service.ts`). Four new internal modules under `src/backend/review/`. Extensions to `GitHubService`, `AIReviewService`, and `EnvSchema`.

**Why:** Developer request to automate cross-agent code review — Claude authors code, GPT-4o (or vice versa) reviews it, findings posted as GitHub PR inline comments. GitHub is the shared collaboration surface.

**How to apply:** Implementation should follow the 15-step phased order defined in Section 15. Phase 1 is pure functions (no external calls) — safe starting point. Open questions OQ-3 (line vs. position API) and OQ-6 (js-yaml dependency) must be resolved before Phase 2 begins. Existing `reviewsTable` and `ReviewsRepository` are reused — no new DB tables for MVP.

**Key architectural decisions recorded in spec:**
- `openai` npm package added for GPT-4o calls. `js-yaml` added for `.agent-review.yml` parsing (pending OQ-6).
- `GitHubService` extended with `listPullRequestReviewComments` and `addLabels` — no new HTTP client.
- Deduplication is pure inline Levenshtein (first 120 chars) — no external similarity library.
- Diff chunking: 100K token budget per chunk (80K for OpenAI, 120K for Claude).
- DB write failures are non-blocking (matches existing pattern in `review-pr.tool.ts` line 177).
- API keys never appear in tool responses or log objects.
