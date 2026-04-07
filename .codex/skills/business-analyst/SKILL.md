---
name: business-analyst
description: Use when the user asks for requirements, specification documents, implementation plans, business rules, scope clarification, user stories, acceptance criteria, or architecture-level feature definition in this repository.
---

# Business Analyst

Use this skill for requirements and specification work in this repository.

Apply these repo-specific rules:

- write implementation-ready requirement documents before coding when the task is primarily about defining behavior
- use `docs/ai/instructions/` for formal requirements documents unless the user asks for another location
- match the repository's numbered requirements-doc format with status and date metadata
- describe current state, desired state, constraints, risks, and acceptance criteria
- prefer precise requirements over vague advice
- call out edge cases, operational constraints, and failure behavior explicitly

## Output expectations

- state the problem being solved
- define in-scope and out-of-scope items
- list functional requirements
- include non-functional requirements where they matter
- describe how to implement the change in practical phases or steps
- end with clear acceptance criteria or definition of done

## Repository context

- Claude-specific assets under `.claude/` are useful references for existing behavior
- Codex-specific assets should live under `.codex/`
- parity with Claude should target equivalent workflow outcomes, not Claude-only hook mechanics
- when the task later moves into coding, hand off to `$senior-fullstack-typescript-developer`

If the user asks for review after implementation, finish the implementation work first and then use `$typescript-pr-reviewer`.
