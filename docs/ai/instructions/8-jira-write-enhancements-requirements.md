# 8 — Jira Write Enhancements Requirements

> **Status:** Pending Implementation
> **Created:** 2026-04-08

---

## 1. Purpose

Define the requirements to expand the Jira integration from basic issue creation, search, transition, and plain rich-text comments into a more complete write surface that supports:

- updating an existing Jira issue description
- updating Jira issue/task fields beyond status transitions
- creating Jira comments with full Atlassian Document Format (ADF) support, including tables and task-list style content

The outcome must let MCP agents perform common Jira maintenance work without leaving the MCP tool surface or forcing users to manually edit content in the Jira UI.

---

## 2. Current State

The current Jira integration provides:

- `jira_search_issues`
- `jira_create_issue`
- `jira_transition_issue`
- `jira_get_comments`
- `jira_add_comment`

Current implementation constraints:

- issue creation supports a markdown `description` that is converted to ADF
- comment creation supports markdown `body` that is converted to ADF
- there is no tool for updating an existing issue description
- there is no general Jira issue update tool for editable fields such as summary, description, labels, assignee, priority, or due date
- the current `markdown-to-adf.ts` converter only supports a limited subset of ADF-oriented content:
  - headings
  - paragraphs
  - bullet and ordered lists
  - blockquotes
  - rules
  - code blocks
  - basic inline formatting
- tables are not supported
- Jira task-list style content is not supported
- there is no mechanism to pass raw ADF when markdown is insufficient

Result: agents can create Jira content, but they cannot reliably maintain richly formatted issues or comments after creation.

---

## 3. Goal

Add a complete Jira write path for issue maintenance and rich comments so agents can:

- update issue descriptions after creation
- update Jira tasks/issues in a structured and safe way
- post comments that preserve advanced Jira formatting, especially tables and task-list content
- use either markdown convenience input or explicit raw ADF when precise rendering is required

---

## 4. Scope

### In Scope

- new MCP capability to update an existing Jira issue description
- new MCP capability to update existing Jira issue/task fields
- full ADF support for Jira comments
- full ADF support for issue descriptions when creating or updating issues
- table support in rich Jira comments and descriptions
- task-list style support in rich Jira comments and descriptions
- service-layer validation and normalization for markdown-vs-ADF inputs
- clear error handling for unsupported or invalid write payloads

### Out of Scope

- attachment upload support
- editing or deleting existing Jira comments
- bulk issue updates across multiple issue keys in one call
- workflow automation beyond current explicit tool invocation
- support for every possible Jira custom field in the first iteration

---

## 5. User and Agent Needs

### Primary Users

- developers updating engineering tickets from MCP agents
- analysts and project coordinators maintaining Jira task detail without opening Jira manually
- autonomous agents that need to create status reports, rollout tables, or checklist-style updates directly in Jira

### Key Jobs To Be Done

- revise a ticket description as new implementation details emerge
- update task metadata after triage or execution
- post structured progress comments with tables
- post checklist-oriented comments that render properly in Jira Cloud

---

## 6. Functional Requirements

### REQ-1: Dedicated Description Update Tool

Add a new MCP tool named `jira_update_issue_description`.

The tool must:

- require `issueKey`
- accept either `descriptionMarkdown` or `descriptionAdf`
- reject requests that provide both fields or neither field
- update only the Jira issue description field
- return a structured success response containing at minimum:
  - `issueKey`
  - `updatedFields`
  - `mode` (`markdown` or `adf`)

Rationale:

- the user explicitly needs an "update issue description" action
- a dedicated tool is easier for agents to discover and use safely than a generic update payload for this common case

### REQ-2: General Jira Issue Update Tool

Add a new MCP tool named `jira_update_issue`.

The tool must support updating a safe first-pass set of editable Jira fields:

- `summary`
- `descriptionMarkdown`
- `descriptionAdf`
- `labels`
- `priority`
- `assigneeAccountId`
- `dueDate`

The tool must:

- require `issueKey`
- require at least one updatable field
- reject incompatible combinations:
  - `descriptionMarkdown` with `descriptionAdf`
- perform partial updates without overwriting unspecified fields
- map payloads to Jira Cloud v3 edit-issue semantics
- return a structured success payload identifying which fields were updated

Notes:

- `priority` must be passed in a clearly documented form; the implementation may use priority name in v1 if that is the simplest stable mapping
- `dueDate` must use ISO `YYYY-MM-DD`
- `labels` must replace the full label set for this operation unless a later requirement adds append/remove semantics

### REQ-3: Create/Update Description Parity

Issue descriptions must support the same rich input options during both create and update flows.

This means:

- `jira_create_issue` must be upgraded to accept the same description input model used by the new update tools
- description behavior must be documented consistently across all Jira write tools
- markdown descriptions and raw ADF descriptions must produce equivalent Jira API request shapes after normalization

### REQ-4: Full ADF Comment Input Support

Enhance `jira_add_comment` so it accepts either:

- `bodyMarkdown`
- `bodyAdf`

The tool must:

- reject requests with both or neither
- pass raw ADF through without lossy conversion
- continue supporting markdown for simple authoring
- clearly document that raw ADF is the preferred path when exact Jira rendering is required

### REQ-5: Table Support

The Jira write pipeline must support tables in comments and descriptions.

At minimum, the solution must support:

- raw ADF table payloads passed directly by agents
- markdown-originated tables if the chosen parser/converter can support them reliably

Implementation requirement:

- if markdown table conversion is not fully reliable in the first implementation, raw ADF table support is mandatory and must be the documented fallback
- the tool layer must not claim markdown table support unless automated verification proves the generated ADF is valid for Jira Cloud

### REQ-6: Task-List Support

The Jira write pipeline must support Jira task-list style content in comments and descriptions.

At minimum, the solution must support:

- raw ADF task-list / task-item payloads
- markdown-originated checklist content only if conversion semantics are well-defined and tested

Implementation requirement:

- if markdown checkbox syntax cannot be converted safely, the system must still support task lists through raw ADF input

### REQ-7: Shared Normalization Layer

Introduce a shared Jira rich-content normalization layer used by:

- `jira_create_issue`
- `jira_update_issue_description`
- `jira_update_issue`
- `jira_add_comment`

The normalization layer must:

- accept a mutually exclusive markdown-or-ADF input shape
- validate raw ADF document structure at a practical boundary
- convert markdown to ADF when markdown input is used
- return a Jira-ready ADF document object
- emit actionable validation errors for malformed ADF or invalid input combinations

### REQ-8: Raw ADF Validation

Raw ADF input must be validated before sending it to Jira.

Validation must ensure at minimum:

- top-level object shape resembles an ADF document
- `type` is `doc`
- `version` is `1`
- `content` is an array

The implementation may begin with lightweight schema validation rather than full Atlassian-spec validation, but invalid payloads must fail locally with a clear error instead of relying entirely on Jira API rejection.

### REQ-9: Error Handling

All new Jira write tools must provide consistent failure behavior.

Errors must clearly distinguish:

- no connected Jira integration
- invalid tool input
- invalid raw ADF payload
- unsupported update field combination
- Jira API validation failure
- permission/authentication failure
- issue not found

Tool responses must remain MCP-safe text responses with `isError: true` where appropriate, consistent with current tool conventions.

### REQ-10: Backward Compatibility

Existing tool names must remain valid.

Backward compatibility expectations:

- existing clients using `jira_add_comment` with the current markdown body must continue to work through an input migration path or compatible aliasing
- existing clients using `jira_create_issue` with the current `description` field should continue to work unless the migration is explicitly documented and handled

Preferred approach:

- keep current fields temporarily and normalize them into the new richer input model
- document deprecated aliases in the requirements and code comments where necessary

---

## 7. Data Contracts

### 7.1 `jira_update_issue_description`

Input contract:

```json
{
  "issueKey": "ENG-123",
  "descriptionMarkdown": "## Updated plan\nNew scope details here"
}
```

or

```json
{
  "issueKey": "ENG-123",
  "descriptionAdf": {
    "type": "doc",
    "version": 1,
    "content": []
  }
}
```

Success response shape:

```json
{
  "success": true,
  "issueKey": "ENG-123",
  "updatedFields": ["description"],
  "mode": "markdown"
}
```

### 7.2 `jira_update_issue`

Input contract:

```json
{
  "issueKey": "ENG-123",
  "summary": "Improve Jira write support",
  "labels": ["mcp", "jira"],
  "dueDate": "2026-04-18"
}
```

Description update example:

```json
{
  "issueKey": "ENG-123",
  "descriptionAdf": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "table",
        "content": []
      }
    ]
  }
}
```

### 7.3 `jira_add_comment`

Preferred new contract:

```json
{
  "issueKey": "ENG-123",
  "bodyMarkdown": "| Item | Status |\n|---|---|\n| API | Done |"
}
```

or

```json
{
  "issueKey": "ENG-123",
  "bodyAdf": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "table",
        "content": []
      }
    ]
  }
}
```

Compatibility requirement:

- the current `body` field must remain temporarily supported as a markdown alias unless deliberately removed in a separately documented breaking change

---

## 8. Architecture & Implementation Requirements

### Service Layer

Extend `src/backend/services/jira.service.ts` with:

- `updateIssueDescription(issueKey, descriptionAdf)`
- `updateIssue(issueKey, fields)`
- shared Jira edit-issue request composition

The service must continue using Jira Cloud REST API v3.

Recommended endpoint:

- `PUT /rest/api/3/issue/{issueKey}`

### Rich Content Layer

Replace or extend `src/backend/services/markdown-to-adf.ts` with a richer content module that can:

- preserve current markdown support
- add optional markdown table handling if reliable
- expose a shared `normalizeRichJiraContent(...)` style helper

If the existing file remains markdown-specific, introduce a new neutral service such as:

- `src/backend/services/jira-rich-content.service.ts`

### Tool Layer

Add new tool files:

- `src/backend/tools/jira/update-issue-description.tool.ts`
- `src/backend/tools/jira/update-issue.tool.ts`

Update existing tool files:

- `src/backend/tools/jira/create-issue.tool.ts`
- `src/backend/tools/jira/add-comment.tool.ts`

Update registrations in:

- `src/backend/server.ts`

### Shared Schemas

Add shared Zod schemas for:

- raw ADF document boundary validation
- mutually exclusive markdown-vs-ADF inputs
- Jira issue update request payloads

Preferred location:

- `src/shared/schemas/jira.schema.ts`

---

## 9. Non-Functional Requirements

### NFR-1: Minimal Surface Expansion

Add the smallest tool surface that satisfies the user need while keeping common actions obvious.

Implication:

- dedicated description update plus one general issue update tool is preferred over many narrow field-specific tools

### NFR-2: Safety

The update tool must not silently clear fields that were not provided.

### NFR-3: Predictability

Markdown inputs that cannot be represented faithfully in Jira ADF must fail clearly or require raw ADF; they must not silently degrade into misleading rendered content.

### NFR-4: Backward Compatibility

Existing Jira write clients should continue working during rollout.

### NFR-5: Testability

The solution must be structured so ADF normalization and Jira request-payload composition can be unit tested without live Jira access.

---

## 10. Risks and Constraints

### Risk-1: False Claim of “Full Markdown Support”

Jira ADF supports structures that simple markdown does not represent cleanly, especially task lists and advanced tables.

Mitigation:

- treat raw ADF as a first-class input mode
- only advertise markdown features that are covered by tests

### Risk-2: Jira Field Variability

Editable fields can differ across Jira projects and custom field configurations.

Mitigation:

- keep v1 general update support limited to standard fields
- avoid promising universal custom-field editing in this requirement

### Risk-3: Breaking Existing Clients

Changing tool inputs too aggressively could break existing agent prompts or integrations.

Mitigation:

- preserve current fields as aliases during rollout
- document deprecation instead of breaking immediately

### Constraint-1: Jira Cloud API Semantics

The implementation must follow Jira Cloud v3 issue edit semantics and ADF body rules, not Jira Server/Data Center assumptions.

---

## 11. Implementation Phases

### Phase 1: Shared Rich Content Foundation

- add shared ADF schemas
- add markdown-or-ADF normalization helper
- preserve current markdown behavior
- add raw ADF validation

### Phase 2: New Jira Update Tools

- implement `jira_update_issue_description`
- implement `jira_update_issue`
- register both tools in the MCP server

### Phase 3: Upgrade Existing Write Tools

- upgrade `jira_add_comment` to support `bodyMarkdown` and `bodyAdf`
- upgrade `jira_create_issue` to support `descriptionMarkdown` and `descriptionAdf`
- preserve legacy aliases for compatibility

### Phase 4: Verification

- add tests for normalization and request composition
- add tests for table and task-list raw ADF acceptance
- add tests for invalid ADF rejection
- add tests for backward-compatible legacy fields

---

## 12. Acceptance Criteria

This requirement is complete when all of the following are true:

1. An MCP client can update an existing Jira issue description through `jira_update_issue_description`.
2. An MCP client can update at least summary, description, labels, priority, assignee, and due date through `jira_update_issue`.
3. `jira_add_comment` accepts raw ADF and can post a Jira comment containing a valid ADF table.
4. Jira task-list style ADF content can be posted in comments and issue descriptions.
5. `jira_create_issue` and description-update flows support the same rich-content input model.
6. Invalid raw ADF is rejected before the Jira API call with a clear validation error.
7. Existing markdown-based Jira comment and issue-creation flows continue working.
8. The implementation includes automated tests for:
   - markdown normalization
   - raw ADF validation
   - issue update payload composition
   - comment payload composition for table/task-list content

---

## 13. Definition of Done

- requirements are approved
- new Jira write tools are implemented
- existing Jira write tools are upgraded for shared rich-content handling
- tests pass
- `pnpm typecheck` passes
- tool descriptions and schemas clearly document markdown vs raw ADF behavior
