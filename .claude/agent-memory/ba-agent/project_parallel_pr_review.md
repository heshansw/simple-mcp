---
name: Multi-Agent Parallel PR Review
description: Full requirements spec written 2026-04-29 for multi-agent parallel PR review system — multiple AI tools review PRs in parallel, drafts stored in DB, synthesiser agent merges and posts one consolidated GitHub review
type: project
---

Multi-agent parallel PR review requirements document written on 2026-04-29.

**Why:** User wants AI diversity in reviews — each LLM catches different classes of issues. The consolidated review deduplicates overlapping findings and attributes comments to the originating AI.

**Requirements document location:** `docs/ai/instructions/7-multi-agent-pr-review-requirements.md`

**Key architecture decisions recorded in the spec:**

- Coordination primitive: `agent_start_run` (client-driven mode — server does not spawn subprocesses or hold AI API keys for Gemini/Codex)
- Three new DB tables: `repo_review_configs`, `review_sessions`, `review_session_drafts`
- Six new MCP tools: `get_repo_review_config`, `set_repo_review_config`, `start_pr_review_session`, `store_agent_review_draft`, `get_review_session_drafts`, `publish_consolidated_review`
- New agent: `review-synthesiser` (ID: `review-synthesiser`, file: `review-synthesiser.agent.ts`)
- Dedup rules: exact (same path+position+category) → merge with dual attribution; adjacent (±3 lines, same category) → merge; divergent → keep separate
- Verdict escalation: REQUEST_CHANGES > COMMENT > APPROVE
- Default AI tool config: claude enabled, gemini enabled, codex opt-in only
- Phase 2 is API-only (no frontend); Phase 3 adds admin UI

**How to apply:** When implementing, work through the file impact summary in Section 7 of the spec. Start with DB schema additions and repositories, then tools, then the synthesiser agent definition. All 6 tools must be registered in both the MCP server and the `ToolHandlerRegistry` so the synthesiser agent can call them.
