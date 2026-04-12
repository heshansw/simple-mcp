# 9 — Jira Assignment, Status, and Mention Requirements

> **Status:** Implemented
> **Created:** 2026-04-09

---

## 1. Purpose

Define the requirements to complete the Jira collaboration surface in MCP so agents can reliably:

- assign Jira tasks/issues to users
- change Jira issue status in a usable way
- mention Jira users in comments

The goal is to remove the current gap where some low-level Jira write primitives exist, but common day-to-day task coordination workflows are still incomplete or too Jira-specific for reliable MCP use.

---

## 2. Current State

The current Jira MCP integration already provides:

- `jira_search_issues`
- `jira_create_issue`
- `jira_update_issue`
- `jira_update_issue_description`
- `jira_transition_issue`
- `jira_get_comments`
- `jira_add_comment`

Current practical limitations:

- assignee updates are only modeled through `assigneeAccountId`, which requires Jira-specific identity data that agents usually do not have
- there is no dedicated assignee lookup or resolution flow by human-usable identity such as display name or email
- status changes require a raw `transitionId`, which is not a user-friendly status model
- there is no MCP-level abstraction to change issue status by desired status name when multiple Jira workflows exist
- there is no documented or validated support for Jira user mentions in comment authoring
- there is no mention-resolution capability that can map a human target into the ADF mention shape Jira expects
- the current comment path supports markdown or raw ADF, but mention-heavy collaboration requires raw Jira-compatible mention nodes or a safe higher-level authoring format

Result: the repository has partial Jira write support, but not a complete collaboration workflow for task ownership, workflow progression, and teammate notification.

---

## 3. Problem Statement

For MCP users, "assign the task to Alice", "move this ticket to In Progress", and "comment and mention Bob" are core Jira actions.

Today those actions are blocked or degraded because:

- assignment depends on Jira account IDs instead of discoverable people identifiers
- status change depends on transition IDs instead of task-oriented intent
- mentions depend on raw ADF knowledge and Jira user metadata that agents do not naturally have

This makes the Jira MCP surface technically capable in places, but operationally incomplete for real coordination work.

---

## 4. Goal

Add a complete Jira collaboration capability set so agents can:

- assign or unassign issues using human-usable identity inputs
- change issue status through a safe, discoverable workflow
- create comments that mention specific Jira users without requiring raw ADF authoring by default

The design must remain compatible with Jira Cloud workflow variability and identity constraints.

---

## 5. Scope

### In Scope

- Jira assignee lookup and resolution requirements
- Jira issue assignment and unassignment requirements
- Jira status transition discovery requirements
- Jira status change requirements using friendly semantics
- Jira comment mention authoring requirements
- Jira user lookup or resolution for mentions
- validation, error handling, and compatibility rules for the above

### Out of Scope

- editing existing comments to add or remove mentions
- watching/unwatching issues
- Jira approval workflows or sprint planning features
- bulk reassignment or bulk status changes
- support for every Jira user-search mode in the first iteration

---

## 6. User and Agent Needs

### Primary Users

- developers coordinating implementation work through Jira
- engineering managers and leads triaging and reassigning work
- autonomous agents updating task ownership and progress
- agents posting execution updates that notify the right stakeholders

### Key Jobs To Be Done

- assign a ticket to a teammate by a recognizable identifier
- clear an assignee when work returns to triage
- move a ticket to the next valid workflow state
- discover why a requested status change is not possible
- post an update comment and mention the responsible or affected user

---

## 7. Functional Requirements

### REQ-1: Jira User Resolution Capability

Add a Jira user-resolution capability that lets MCP tools map human-usable identity input to Jira account metadata.

The system must support at least one dedicated MCP tool, such as `jira_find_users`, or an equivalent internal resolution path used by assignment and mention flows.

The resolution model must accept one or more of:

- exact or partial display name
- email address when Jira permissions allow it
- Jira account ID

The success payload must return enough information for later tool use:

- `accountId`
- `displayName`
- whether the match is exact, partial, or ambiguous

If the Jira site restricts email visibility or user search, the tool must fail clearly rather than silently returning misleading results.

### REQ-2: Assign and Unassign Issue Capability

Provide an MCP capability for issue assignment.

The design may extend `jira_update_issue` or add a dedicated `jira_assign_issue` tool, but the user-facing behavior must support:

- assigning by `accountId`
- assigning by a resolvable human-usable identity input
- explicitly clearing the assignee

The tool must:

- require `issueKey`
- require exactly one assignee operation:
  - assign by account ID
  - assign by resolved identity input
  - unassign
- return a structured success payload with:
  - `issueKey`
  - `assignee`
  - `resolutionMode`

If identity input resolves to multiple users, the operation must fail with an ambiguity error rather than assigning arbitrarily.

### REQ-3: Status Transition Discovery

Expose Jira workflow transition discovery in an agent-usable way.

The system must provide a tool such as `jira_get_transitions` or expand the current transition surface so agents can retrieve:

- available transitions for an issue
- transition IDs
- transition names
- destination status names

The response must make it practical to answer:

- what statuses are currently reachable
- which transition ID corresponds to each status
- whether a requested target status is unavailable from the issue's current state

### REQ-4: Friendly Status Change Workflow

Status change must be usable without requiring the caller to already know a Jira transition ID.

The system must support one of these patterns:

1. a high-level `jira_change_status` tool that accepts a target status name and resolves the correct transition
2. a clearly documented two-step workflow using transition discovery followed by `jira_transition_issue`

Minimum required behavior:

- agents must be able to request a change by intended status name
- if exactly one valid transition matches that status, the change may proceed
- if no valid transition matches, the tool must return the current reachable statuses
- if multiple transitions could satisfy the request, the tool must fail with a disambiguation error

Raw `transitionId` support must remain available for advanced callers.

### REQ-5: Comment Mention Authoring

Enhance Jira comment support so agents can mention users intentionally without hand-authoring raw ADF mention nodes.

The comment write path must support at least one structured mention input model, such as:

- comment markdown/body plus a separate `mentions` array
- a richer comment-content model that includes mention tokens

The system must convert that higher-level input into Jira-compatible ADF mentions containing the resolved Jira account ID.

The feature must support:

- one or more mentions in a single comment
- mentions appearing alongside normal rich text
- no-op behavior when no mentions are requested

### REQ-6: Mention Resolution Rules

Mention creation must use the same user-resolution rules as assignment wherever practical.

Requirements:

- mention targets must resolve to exactly one Jira user before comment creation
- ambiguous mention targets must fail before the comment is posted
- unresolved mention targets must fail with an actionable validation error
- the comment tool must not silently downgrade a failed mention into plain text that looks like a mention

### REQ-7: Shared Jira Identity Layer

Introduce a shared Jira identity-resolution layer used consistently by:

- assignee flows
- mention flows
- any future Jira user-targeting tools

The shared layer must:

- normalize the supported identity inputs
- perform Jira lookup calls
- classify results as exact, partial, ambiguous, or not found
- return a stable internal result shape to the service and tool layers

This avoids implementing slightly different user-resolution behavior in separate Jira tools.

### REQ-8: Validation and Error Handling

All new assignment, status, and mention features must provide consistent failure behavior.

Errors must clearly distinguish:

- no connected Jira integration
- invalid tool input
- ambiguous user resolution
- user not found
- requested status not reachable from current issue state
- multiple possible transitions for the requested status
- Jira permission or authentication failure
- issue not found
- Jira API validation failure

Tool responses must follow existing MCP conventions with text content and `isError: true` where appropriate.

### REQ-9: Backward Compatibility

Existing Jira tools must remain valid.

Compatibility expectations:

- `jira_transition_issue` must continue to support raw `transitionId`
- `jira_update_issue` must continue to support direct `assigneeAccountId`
- `jira_add_comment` without mention input must continue to behave as it does today

New functionality must be additive unless an explicit migration is documented.

### REQ-10: Documentation and Tool Discoverability

The Jira MCP tool descriptions and repo documentation must make the collaboration workflow discoverable.

Documentation must explain:

- how to find a Jira user before assigning or mentioning them
- how to change status safely when workflow transitions vary by issue
- which tool supports direct transition IDs versus friendly status-driven changes
- the expected failure behavior for ambiguous user matches and unreachable statuses

If the final design relies on a multi-step flow, that flow must be explicit in the tool descriptions and supporting docs.

---

## 8. Non-Functional Requirements

### NFR-1: Safety

The system must avoid accidental assignment or accidental mentions by failing on ambiguity rather than choosing a best guess.

### NFR-2: Workflow Compatibility

The design must work with Jira Cloud workflows where status names and available transitions vary by project, issue type, and current issue state.

### NFR-3: Minimal Jira-Specific Burden

Common callers should not need to know Jira transition IDs or raw ADF mention structure for normal use.

### NFR-4: Extensibility

The identity-resolution and status-resolution design should be reusable for future Jira features such as reporter targeting, watcher management, or workflow introspection.

---

## 9. Implementation Approach

### Phase 1: User Resolution

Add a Jira identity lookup capability and shared service-layer resolver.

Implementation focus:

- schema for user search input
- Jira API lookup integration
- exact/ambiguous/not-found classification
- stable return shape for downstream tools

### Phase 2: Assignment Support

Expose assignment as a complete workflow rather than only an account-ID field update.

Implementation focus:

- dedicated tool or clear `jira_update_issue` extension
- unassign support
- response shape with resolved assignee metadata
- ambiguity-safe validation

### Phase 3: Status Change Usability

Make status changes discoverable and practical for agents.

Implementation focus:

- transition discovery tool
- status-name-based change flow or explicit documented wrapper
- clear unreachable-status errors

### Phase 4: Comment Mentions

Add structured mention support in the Jira comment pipeline.

Implementation focus:

- mention-aware comment input schema
- conversion into valid Jira ADF mention nodes
- shared identity resolution
- tests for mixed rich text plus multiple mentions

### Phase 5: Documentation and Verification

Update tool descriptions, repo documentation, and tests.

Implementation focus:

- schema validation tests
- service-layer resolution tests
- comment mention rendering tests
- transition resolution tests

---

## 10. Risks and Constraints

### Risk-1: Jira User Search Permissions

Some Jira tenants restrict email visibility or user search behavior.

Mitigation:

- support multiple identity inputs
- surface permission-related lookup failures clearly
- avoid promising email lookup in every environment

### Risk-2: Workflow Ambiguity

Jira transitions do not map cleanly to global status semantics across all projects.

Mitigation:

- prefer transition discovery plus explicit resolution
- fail clearly when multiple transitions match a requested status

### Risk-3: Mention Rendering Errors

Invalid mention ADF could produce broken comments or plain text instead of real notifications.

Mitigation:

- centralize mention node generation
- validate resolved account IDs before posting comments
- test mixed-content comments

### Risk-4: Overloading Existing Tools

Packing too many new behaviors into existing tools could reduce discoverability.

Mitigation:

- prefer explicit tool descriptions
- add dedicated tools where that materially improves usability

---

## 11. Acceptance Criteria

- A requirement-backed Jira user resolution flow exists for assignment and mentions.
- MCP users can assign a Jira issue without already knowing a Jira account ID.
- MCP users can explicitly unassign a Jira issue.
- MCP users can discover available transitions for an issue through MCP.
- MCP users can perform a status change through a documented, agent-usable workflow that does not require prior knowledge of a raw transition ID.
- MCP users can create a Jira comment that mentions one or more resolved Jira users.
- Ambiguous user matches fail safely for both assignment and mentions.
- Unreachable requested statuses fail with a response that includes the statuses or transitions that are actually available.
- Existing raw `transitionId`, `assigneeAccountId`, and ordinary comment flows remain backward compatible.
- The Jira collaboration workflow is documented under `docs/ai/instructions/` and reflected in tool descriptions when implemented.
