---
name: Agent Execution Engine Architecture
description: Design decisions and file locations for the agentic execution layer added to the MCP server — engine loop, tool registry, working memory, guardrails, delegation, and persistence
type: project
---

The agentic execution engine was implemented on 2026-04-03 to turn metadata-only agent definitions into autonomous, self-correcting workflows.

**Why:** Agents were definitions (requiredTools, systemPrompt) with no runtime execution capability. Claude was the sole orchestrator. The engine adds a plan→execute→reflect loop powered by the Anthropic SDK.

**How to apply:**
- Engine source lives in `src/backend/agents/engine/` (9 files)
- New MCP tools: `agent_execute`, `agent_status`, `agent_list` in `src/backend/tools/system/`
- DB tables: `agent_runs`, `agent_tasks` in schema.ts
- Tool handler registry bridges MCP tools to in-process invocation (no JSON-RPC self-calls)
- Delegation uses `setExecuteFn()` pattern to break circular dependency between engine and handler
- `domainErrorMessage()` is the canonical way to extract human-readable text from any DomainError variant
- `AgentExecutionError` was added to the DomainError union in result.ts — all exhaustive switches must handle it
