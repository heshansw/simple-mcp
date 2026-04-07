# 7 — Codex MCP Parity Requirements

> **Status:** Implemented
> **Created:** 2026-04-07
> **Updated:** 2026-04-07

---

## 1. Purpose

Define the requirements to give Codex the same practical repository support currently provided for Claude in this project, while respecting Codex's native workflow and avoiding Claude-only hooks or assumptions.

This is a parity and migration specification, not a request to replace Claude support.

---

## 2. Current Claude Capability Baseline

The repository already provides a Claude-oriented working model through:

- `.claude/settings.json`: automatic `UserPromptSubmit` routing via `.claude/scripts/agent-router.sh`
- `.claude/agents/`: role assets for business analysis, implementation, review, and QA
- `.claude/settings.local.json`: local MCP permission allowlist for tracked agent-run tools
- `CLAUDE.md`: explicit routing and persona-switching rules
- Existing MCP server tools: `agent_list`, `agent_start_run`, `agent_record_step`, `agent_update_task`, and `agent_complete_run`

Claude currently benefits from:

- automatic prompt intent classification before response generation
- a business-analyst persona for requirements/specification work
- documented role handoff rules between BA, implementation, review, and QA
- a repo-local MCP workflow already aligned to tracked agent runs

---

## 3. Problem Statement

At the time this requirement was written, Codex could connect to the same MCP server, but it did not yet have equivalent repository-native role coverage or routing guidance for requirements/specification work.

The parity gap existed because:

- `.codex/` only defines implementation and review roles
- there is no Codex business-analyst role asset or skill
- root guidance in `AGENTS.md` only documents two Codex roles
- Claude's hook-based auto-routing cannot be assumed to exist in Codex
- parity expectations are not captured in a dedicated requirement document

Result: requirements work that was automatically shaped into a BA workflow for Claude could be handled inconsistently in Codex.

---

## 4. Goal

Codex must provide equivalent repository guidance for requirement-definition work so that a request such as "write a spec", "define requirements", or "document how to implement parity with Claude MCP" reliably activates a business-analyst style workflow and produces implementation-ready output.

Parity means equivalent outcome and operator experience, not literal duplication of Claude-specific hook mechanics.

---

## 5. Functional Requirements

### REQ-1: Codex Business Analyst Role

Create a Codex-native BA role asset under `.codex/agents/` for:

- requirements elicitation
- scope clarification
- business rules and edge-case definition
- implementation-ready requirement documents
- clear separation between specification work and production coding

The role must:

- instruct Codex to define ambiguity before coding
- prefer measurable, testable requirements
- require error cases, constraints, and acceptance criteria
- produce output suitable for developer handoff

### REQ-2: Codex Business Analyst Skill

Create a matching Codex skill under `.codex/skills/` so the role is discoverable through Codex skill triggering and UI metadata.

The skill must:

- clearly describe when it should be used
- tell Codex to produce structured requirement documents
- emphasize functional requirements, non-functional requirements, business rules, interfaces, and acceptance criteria
- remain concise and repo-specific

### REQ-3: Repository Guidance Parity

Update repository-scoped Codex guidance so BA work is first-class, alongside implementation and review.

The guidance must:

- list the BA role and skill in `AGENTS.md`
- explain when the BA role should be used
- preserve the current instruction that Claude artifacts are references, not direct Codex configuration
- avoid claiming Codex supports Claude's `UserPromptSubmit` hook model

### REQ-4: Requirements Document Standard

Codex must produce requirements documents under `docs/ai/instructions/` using the established repository style:

- numbered file naming
- status and date metadata
- clear problem statement and goals
- implementation requirements and constraints
- explicit acceptance criteria
- practical implementation approach

### REQ-5: Codex Workflow Alignment

The parity design must align to the repo's existing Codex MCP workflow:

1. discover agents with `agent_list`
2. start tracked work with `agent_start_run`
3. use normal MCP tools during execution
4. record material progress with `agent_record_step`
5. maintain task state with `agent_update_task`
6. finish with `agent_complete_run`

The parity effort must not require Codex to use Claude's server-side Anthropic execution loop by default.

---

## 6. Non-Functional Requirements

### NFR-1: Neutrality

New Codex documentation must use neutral wording where possible and avoid branding the repo as Claude-only.

### NFR-2: Minimal Change Surface

The implementation should add the smallest set of Codex assets and guidance needed for parity. Existing `.claude/` files must remain intact unless a future task explicitly changes Claude behavior.

### NFR-3: Discoverability

A future contributor should be able to identify the Codex BA workflow by reading:

- `AGENTS.md`
- `.codex/agents/business-analyst.md`
- `.codex/skills/business-analyst/SKILL.md`

### NFR-4: Consistency

The new BA assets must match the tone and structure already used in `.codex/agents/` and `.codex/skills/`.

---

## 7. Implementation Approach

### Phase 1: Add Codex BA Assets

Create:

- `.codex/agents/business-analyst.md`
- `.codex/skills/business-analyst/SKILL.md`
- `.codex/skills/business-analyst/agents/openai.yaml`

Content requirements:

- role file describes when to use the BA persona and what good output looks like
- skill file provides repo-specific instructions for requirements work
- `openai.yaml` exposes a display name, short description, and default prompt consistent with the skill

### Phase 2: Update Codex Repository Instructions

Update `AGENTS.md` to:

- add the BA role to the Codex role list
- add the BA skill path
- clarify that specification work should use the BA role before implementation

### Phase 3: Use Requirements Docs as the Delivery Artifact

For parity initiatives, create requirement documents in `docs/ai/instructions/` that:

- compare current Claude support to current Codex support
- define the target Codex behavior
- describe implementation steps
- define acceptance criteria for completion

---

## 8. Delivery Scope

### In Scope

- Codex BA role asset
- Codex BA skill asset
- Codex guidance updates in repo documentation
- requirement documents for Codex parity work

### Out of Scope

- replacing Claude-specific hooks with a Codex hook system
- deleting or rewriting `.claude/` assets
- changing MCP server tool contracts solely for naming parity
- implementing a new server-side AI execution provider for Codex

---

## 9. Risks and Constraints

### Risk-1: False Parity Assumption

If the implementation claims "same functionality" without documenting Codex-specific constraints, future contributors may incorrectly expect Claude hook behavior inside Codex.

Mitigation:

- document parity as equivalent workflow outcome, not mechanism duplication

### Risk-2: Skill Exists But Is Not Referenced

If the BA skill is added without updating `AGENTS.md`, discoverability remains poor.

Mitigation:

- update root instructions in the same change set

### Risk-3: Overly Generic BA Instructions

If the BA role is too broad, Codex may generate generic documentation instead of implementation-ready specs.

Mitigation:

- require structured outputs, explicit constraints, and acceptance criteria

---

## 10. Acceptance Criteria

- A Codex BA role exists at `.codex/agents/business-analyst.md`.
- A Codex BA skill exists at `.codex/skills/business-analyst/SKILL.md`.
- Codex skill UI metadata exists at `.codex/skills/business-analyst/agents/openai.yaml`.
- `AGENTS.md` references the Codex BA role and skill alongside the existing Codex assets.
- A requirement document under `docs/ai/instructions/` defines the Codex parity objective, scope, implementation approach, and acceptance criteria.
- The new Codex assets do not require any edits to `.claude/` files.
- The parity design explicitly states that Codex should use the tracked run workflow rather than assume Claude hook behavior.

---

## 11. Definition of Done

This requirement is complete when:

1. the BA role and skill are committed in `.codex/`
2. root Codex guidance references them
3. the repository contains this requirement document as the implementation contract for Codex parity work

### Implementation Notes

This requirement is implemented by:

- `.codex/agents/business-analyst.md`
- `.codex/skills/business-analyst/SKILL.md`
- `.codex/skills/business-analyst/agents/openai.yaml`
- `AGENTS.md`
- `README.md`
