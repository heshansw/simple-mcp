#!/usr/bin/env bash
# Agent Router — fires on every UserPromptSubmit event.
# Reads the user's prompt from stdin JSON, classifies intent,
# and injects additionalContext to activate the right agent persona.
#
# Agents available:
#   ba-agent               — requirements, specs, design, architecture planning
#   senior-fullstack-ts-dev — implementation, coding, debugging, refactoring
#   js-reviewer            — code review, PR review, auditing
#   qa-agent               — tests, coverage, regression, e2e

set -euo pipefail

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""' 2>/dev/null || echo "")

CONTEXT=""

# --- BA Agent: requirements, design, specs, planning ---
if echo "$PROMPT" | grep -qiE \
  '\bspec\b|requirement|user story|acceptance criteria|feature request|\bdesign\b|\barchitect\b|what should (we|i|it)|how should (we|i|it)|define (the|a|an)|clarif(y|ication)|scope|wireframe|data model|api contract|system design|business rule|non.functional'; then
  CONTEXT="[AGENT ROUTER] Activating ba-agent: requirements/design/spec intent detected. Adopt the TECH_BA_PRO persona — elicit missing details, ask clarifying questions, and produce structured spec output following the template in .claude/agents/ba-agent.md."

# --- JS Reviewer: code review, PR review ---
elif echo "$PROMPT" | grep -qiE \
  '\breview\b|pull request|\bPR\b|code review|LGTM|audit (the|my|this|our)|check (my|the|this) code|look(s| it) good|is this (correct|right|ok)|give.*feedback'; then
  CONTEXT="[AGENT ROUTER] Activating js-reviewer: code review intent detected. Adopt the js-reviewer persona — apply the full checklist (correctness, TypeScript, error handling, architecture, security, performance, tests) and output in the standard PR review format from .claude/agents/js-reviewer.md."

# --- QA Agent: testing, coverage, regression ---
elif echo "$PROMPT" | grep -qiE \
  '\btest(s|ing)?\b|coverage|regression|\be2e\b|end.to.end|unit test|integration test|vitest|\bmock\b|\bstub\b|\bspy\b|write.*test|add.*test|test.*for|assert|snapshot'; then
  CONTEXT="[AGENT ROUTER] Activating qa-agent: testing/QA intent detected. Adopt the qa-agent persona — write thorough tests following the project's Vitest conventions, covering happy path, error cases, and edge cases as defined in .claude/agents/qa-agent.md."

# --- Senior TS Dev: implementation, coding, fixes ---
elif echo "$PROMPT" | grep -qiE \
  '\bimplement\b|\bbuild\b|\bcreate\b|\bfix\b|\brefactor\b|\bdebug\b|\badd\b.*feature|write (the|a|this)|make (it|this|the)|develop|migrate|upgrade|optimis|integrat|wire up|hook up|connect'; then
  CONTEXT="[AGENT ROUTER] Activating senior-fullstack-ts-dev: implementation/development intent detected. Adopt the senior-fullstack-ts-dev persona — strict TypeScript, Result<T,E> error handling, Drizzle/Zod patterns, and MCP SDK conventions as defined in .claude/agents/senior-fullstack-ts-dev.md."
fi

# Only emit output when a route matched — silence means no injection
if [ -n "$CONTEXT" ]; then
  jq -n --arg ctx "$CONTEXT" \
    '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $ctx}}'
fi
