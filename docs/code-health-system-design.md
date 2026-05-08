# Code Health MCP — Requirements & System Design

**Version:** 1.0
**Date:** 2026-05-09
**Status:** Implemented

---

## Table of Contents

1. [Overview](#1-overview)
2. [Requirements](#2-requirements)
3. [System Architecture](#3-system-architecture)
4. [Data Model](#4-data-model)
5. [Scoring Algorithm](#5-scoring-algorithm)
6. [MCP Tools (13 tools)](#6-mcp-tools)
7. [REST API Endpoints](#7-rest-api-endpoints)
8. [Frontend Components](#8-frontend-components)
9. [Background Analysis System](#9-background-analysis-system)
10. [Integration Points](#10-integration-points)
11. [Technology Stack](#11-technology-stack)
12. [Future Enhancements](#12-future-enhancements)

---

## 1. Overview

### What is Code Health MCP

Code Health MCP is an embedded, privacy-first static analysis system that integrates directly into the `simple-mcp` server. It exposes 13 MCP tools that allow an AI assistant (Claude, Codex, or any MCP client) to measure, track, and improve the structural quality of TypeScript, JavaScript, and Java codebases — without sending any source code to external services.

The feature delivers:

- **7-signal health scoring** on a 1–10 scale with A–F letter grades
- **Snapshot persistence** for trend tracking over time
- **Git hotspot detection** — files that change frequently AND score poorly
- **Session-based self-correcting loops** — the AI starts a session, makes improvements, checks scores, and iterates until a target is reached
- **Pre-commit quality gates** — blocks changes that regress health below a configurable threshold
- **GitHub PR health analysis** — compares before/after scores for changed files
- **Background auto-analysis** — every file read via `fs_read_file` is silently queued for analysis (with a 24-hour debounce)
- **Duplication detection** via `jscpd`
- **TypeScript type coverage analysis** via regex-based static inspection
- **Function-level ranking** by complexity, cognitive load, Halstead effort, or LOC

### Problem It Solves

AI coding agents have no intrinsic awareness of code quality. Without structured feedback, an agent can satisfy a feature requirement while introducing cyclomatic complexity of 40 or nesting depth of 7. Code Health MCP creates a quantitative feedback loop: the agent can self-assess, self-improve, and gate commits against objective quality thresholds — all within the same tool-calling session.

### Key Differentiators vs CodeScene

| Dimension | CodeScene | Code Health MCP |
|---|---|---|
| Data locality | Cloud SaaS | Fully local — no source code leaves the machine |
| Integration | Git hook + CI | MCP tool call — callable mid-session by any agent |
| Cost | Paid subscription | Zero — runs on existing Node.js process |
| Languages | 30+ | TypeScript, JavaScript, Java |
| Hotspot analysis | Commit history + complexity | Same (git log + AST scoring) |
| Agent loop support | None | Native — `start_session` / `session_check` / `end_session` |
| Granularity | File + module | File + function level |

---

## 2. Requirements

### Functional Requirements

**FR-001 — Single-file analysis**
The system must analyze any single `.ts`, `.tsx`, `.js`, `.jsx`, or `.java` file and return a 1–10 health score, a letter grade (A–F), a 7-signal breakdown, per-function metrics, and improvement suggestions with line numbers.

**FR-002 — Directory analysis**
The system must recursively analyze all supported files within a directory up to a configurable maximum (`maxFiles`, default 200). It must skip `node_modules`, `dist`, `.git`, `build`, and `coverage` by default. It must return an aggregate score, a grade distribution histogram, a list of worst-offender files, and total LOC and function counts.

**FR-003 — 7-signal scoring system**
Health scoring must be driven by exactly seven signals: complexity, maintainability, duplication, functionSize, typeSafety, nestingDepth, and parameterCount. Each signal must be scored 1–10 using piecewise linear interpolation. An overall score must be computed as a weighted sum.

**FR-004 — Snapshot persistence**
The system must persist full directory analysis snapshots to SQLite, including per-file metrics and per-function metrics. Each snapshot must capture the git SHA at time of analysis. The snapshot must be linked to a workspace ID when triggered from the admin UI.

**FR-005 — Trend tracking**
The system must support querying historical snapshots for a directory over 7d, 30d, 90d, or all-time periods, at daily, weekly, or monthly granularity. It must report trend direction (improving, declining, stable) and rate of change.

**FR-006 — Git hotspot detection**
The system must invoke `git log` to compute commit frequency, unique author count, bug-fix commit count, and lines added/deleted per file over a configurable lookback window (default 90 days). It must combine this churn data with AST-derived health scores to produce a composite priority score identifying the highest-risk files for refactoring.

**FR-007 — Session tracking (self-correcting loop)**
The system must provide `start_session`, `session_check`, and `end_session` tools. `start_session` must auto-detect changed files via `git diff` and capture baseline scores. `session_check` must re-analyze the tracked files, record iteration count, and indicate whether a configurable target score has been reached. `end_session` must mark the session complete and persist a summary event.

**FR-008 — Pre-commit quality gate**
The system must compare current file scores against the most recent snapshot baseline. It must return a pass/fail result, a per-file verdict, blocking issues, and fix suggestions. It must enforce a configurable maximum regression threshold (default 0.5 points) and an optional minimum score floor.

**FR-009 — PR analysis**
The system must accept a GitHub owner, repo, and PR number. It must fetch the list of changed files via the GitHub service, analyze each locally checked-out file, and produce a markdown-formatted before/after health summary.

**FR-010 — Background auto-analysis on file reads**
Every file read via the `fs_read_file` MCP tool must be silently queued for background health analysis. A 24-hour debounce must prevent redundant re-analysis. The queue must be capped at 200 items. A worker must process the queue every 2 seconds. Results must be persisted to the `code_health_background_jobs` table and emitted as `post_commit_analysis` events.

**FR-011 — Duplication detection**
The system must invoke `jscpd` via `npx` with a configurable minimum-token and minimum-line threshold to detect copy-paste clones across a directory. It must return a `DuplicationReport` including percentage, total duplicated lines, and a list of clone pairs with exact file paths and line ranges.

**FR-012 — Type coverage analysis**
The system must analyze `.ts` and `.tsx` files for explicit `any` usages, missing return type annotations, and type assertion density. Coverage percentage must be estimated from the ratio of type annotations to `any` occurrences.

**FR-013 — Function ranking**
The system must query stored function metrics and return the top N functions sorted by cyclomatic complexity, cognitive complexity, Halstead effort, LOC, or parameter count. A configurable minimum threshold must filter out trivial functions.

### Non-Functional Requirements

**NFR-001 — All analysis runs locally**
No source code, metrics, or scores must be transmitted to any external API or service. All computation runs within the `simple-mcp` Node.js process or via locally installed CLI tools (`git`, `jscpd`).

**NFR-002 — 24-hour debounce for background analysis**
A file that has been analyzed within the last 24 hours must not be re-queued by the background tracker, regardless of how many times it is read.

**NFR-003 — Language support**
The system must support TypeScript (`.ts`, `.tsx`), JavaScript (`.js`, `.jsx`), and Java (`.java`). Language is determined by file extension.

**NFR-004 — Results persisted in SQLite**
All snapshots, file metrics, function metrics, events, sessions, and background jobs must be persisted in the embedded SQLite database at `~/.simple-mcp/data.db`. No in-memory-only state.

**NFR-005 — Directory analysis cap**
Directory analysis must respect a `maxFiles` limit (default 200) to bound execution time. Files are collected via depth-first traversal and the cap is enforced before analysis begins.

**NFR-006 — Background worker does not block MCP responses**
The file access tracker must run its processing loop via `setInterval` (2-second interval). It must not block or slow down any MCP tool response. Queue processing is fire-and-forget relative to the triggering tool call.

---

## 3. System Architecture

### High-Level Architecture

```
 MCP Client (Claude Code / Codex / Claude Desktop)
        |
        | JSON-RPC over stdio / SSE / HTTP
        v
 ┌──────────────────────────────────────────────────────────┐
 │                    McpServer (MCP SDK)                    │
 │                                                          │
 │  ┌────────────────────────────────────────────────────┐  │
 │  │               Code Health Tool Layer (13 tools)    │  │
 │  │  analyze_file  analyze_dir  snapshot  trends       │  │
 │  │  hotspots  pre_commit  analyze_pr  start_session   │  │
 │  │  session_check  end_session  function_ranking      │  │
 │  │  duplication  type_coverage                        │  │
 │  └────────────────┬───────────────────────────────────┘  │
 │                   │ calls                                 │
 │  ┌────────────────▼───────────────────────────────────┐  │
 │  │             Code Health Service Layer               │  │
 │  │  CodeHealthService  HealthScoringService            │  │
 │  │  AstAnalysisService  GitAnalysisService             │  │
 │  │  FileAccessTracker                                  │  │
 │  └────────────────┬───────────────────────────────────┘  │
 │                   │ reads/writes                          │
 │  ┌────────────────▼───────────────────────────────────┐  │
 │  │           Repository Layer (6 repos)               │  │
 │  │  Snapshots  FileMetrics  FunctionMetrics           │  │
 │  │  Events  Sessions  BackgroundJobs                  │  │
 │  └────────────────┬───────────────────────────────────┘  │
 │                   │                                       │
 │              SQLite (Drizzle ORM)                         │
 └──────────────────────────────────────────────────────────┘
        |
        | HTTP REST /api/code-health/*
        v
 ┌──────────────────────────────────────────────────────────┐
 │              Hono HTTP App (Admin Panel API)              │
 └──────────────────────────────────────────────────────────┘
        |
        | TanStack Query
        v
 ┌──────────────────────────────────────────────────────────┐
 │               React 19 Frontend (Admin Panel)            │
 │   /code-health        — Projects list                    │
 │   /code-health/:id    — Project detail + trend chart     │
 └──────────────────────────────────────────────────────────┘

 Background:
 ┌────────────────────────────────────────────┐
 │  FileAccessTracker (setInterval 2s)        │
 │  Intercepts fs_read_file results           │
 │  → Queues supported files                 │
 │  → Checks 24h debounce                    │
 │  → Runs CodeHealthService.analyzeFile     │
 │  → Persists to background_jobs + events   │
 └────────────────────────────────────────────┘
```

### Service Layer Design

Each service is a plain object created by a factory function that receives its dependencies as parameters (no singletons, testable by construction).

| Service | Factory | Responsibility |
|---|---|---|
| `AstAnalysisService` | `createAstAnalysisService` | Parses files via `typhonjs-escomplex` (TS/JS) or `java-parser` (Java), returns `FileAstMetrics` |
| `HealthScoringService` | `createHealthScoringService` | Computes 7-signal breakdown and overall score from `FileAstMetrics` |
| `CodeHealthService` | `createCodeHealthService` | Orchestrates file and directory analysis by combining AST + scoring |
| `GitAnalysisService` | `createGitAnalysisService` | Invokes `git log` and `git log --numstat` to compute per-file churn metrics |
| `FileAccessTracker` | `createFileAccessTracker` | In-process queue + worker that silently re-analyzes files on every `fs_read_file` result |

### Tool Layer Design

Each MCP tool lives in a dedicated file under `src/backend/tools/code-health/` and exports a single `register*Tool(server, deps)` function. Tool files never contain business logic — they parse the input schema, delegate to services, and format the `McpToolResult`. All 13 tools are registered unconditionally on server startup.

### Database Layer Design

Six dedicated Drizzle ORM tables handle all persistence. All repositories are created via factory functions receiving the Drizzle database instance. No raw SQL is used outside the repository layer.

### Frontend Layer Design

The React frontend reads exclusively from the REST API. No MCP tools are called from the frontend. TanStack Query handles caching, with a 10–15 second polling interval on background-job endpoints.

---

## 4. Data Model

### 4.1 `code_health_snapshots`

Represents a point-in-time full-directory analysis. Created by `code_health_snapshot` (MCP tool) or `POST /api/code-health/projects/:id/snapshot` (admin UI).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `text` | PRIMARY KEY | UUID |
| `directory_path` | `text` | NOT NULL | Absolute path of the analyzed directory |
| `workspace_id` | `text` | nullable | FK to `repo_workspaces.id` — set when triggered from admin UI |
| `label` | `text` | nullable | Human label (e.g., `"v1.2.0"`, `"post-refactor"`) |
| `overall_score` | `real` | NOT NULL | Weighted composite score 1–10 |
| `grade` | `text` | NOT NULL | `A` / `B` / `C` / `D` / `F` |
| `file_count` | `integer` | NOT NULL, default 0 | Number of files analyzed |
| `total_loc` | `integer` | NOT NULL, default 0 | Total lines of code |
| `total_functions` | `integer` | NOT NULL, default 0 | Total function count |
| `avg_cyclomatic` | `real` | NOT NULL, default 0 | Aggregate average cyclomatic complexity |
| `avg_cognitive` | `real` | NOT NULL, default 0 | Aggregate average cognitive complexity |
| `duplication_pct` | `real` | NOT NULL, default 0 | Duplication percentage (0 if not run separately) |
| `type_coverage_pct` | `real` | nullable | TypeScript type coverage (null if Java/JS) |
| `config_json` | `text` | NOT NULL, default `{}` | Serialized `{ extensions, skipPatterns }` used for this snapshot |
| `git_ref` | `text` | nullable | HEAD SHA at time of snapshot |
| `created_at` | `text` | NOT NULL | ISO 8601 timestamp |

### 4.2 `code_health_file_metrics`

One row per file per snapshot.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `text` | PRIMARY KEY | UUID |
| `snapshot_id` | `text` | NOT NULL, FK → `code_health_snapshots.id` | Parent snapshot |
| `file_path` | `text` | NOT NULL | Absolute file path |
| `relative_path` | `text` | NOT NULL | Path relative to snapshot's `directory_path` |
| `language` | `text` | NOT NULL | `typescript` / `javascript` / `java` |
| `score` | `real` | NOT NULL | File health score 1–10 |
| `grade` | `text` | NOT NULL | `A`–`F` |
| `loc` | `integer` | NOT NULL, default 0 | Total lines including blank/comments |
| `sloc_logical` | `integer` | NOT NULL, default 0 | Logical source lines (non-empty, non-comment) |
| `function_count` | `integer` | NOT NULL, default 0 | Number of functions/methods |
| `avg_cyclomatic` | `real` | NOT NULL, default 0 | Average cyclomatic complexity across functions |
| `max_cyclomatic` | `real` | NOT NULL, default 0 | Maximum cyclomatic complexity in any function |
| `avg_cognitive` | `real` | NOT NULL, default 0 | Average cognitive complexity |
| `max_cognitive` | `real` | NOT NULL, default 0 | Maximum cognitive complexity |
| `maintainability_index` | `real` | NOT NULL, default 0 | Maintainability Index (0–171 scale) |
| `duplication_lines` | `integer` | NOT NULL, default 0 | Duplicated lines (0 unless explicitly computed) |
| `type_coverage_pct` | `real` | nullable | TypeScript type coverage percentage |
| `any_count` | `integer` | NOT NULL, default 0 | Count of `any` usages |
| `nesting_depth_max` | `integer` | NOT NULL, default 0 | Maximum nesting depth across all functions |
| `issues_json` | `text` | NOT NULL, default `[]` | Serialized `HealthIssue[]` array |
| `created_at` | `text` | NOT NULL | ISO 8601 timestamp |

### 4.3 `code_health_function_metrics`

One row per function per file metric row.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `text` | PRIMARY KEY | UUID |
| `file_metric_id` | `text` | NOT NULL, FK → `code_health_file_metrics.id` | Parent file metric |
| `function_name` | `text` | NOT NULL | Function/method name as extracted by the parser |
| `start_line` | `integer` | NOT NULL | Line where function begins |
| `end_line` | `integer` | NOT NULL | Line where function ends |
| `loc` | `integer` | NOT NULL, default 0 | Lines in function (logical for TS/JS, physical for Java) |
| `parameter_count` | `integer` | NOT NULL, default 0 | Number of parameters |
| `cyclomatic` | `integer` | NOT NULL, default 0 | Cyclomatic complexity |
| `cognitive` | `integer` | NOT NULL, default 0 | Cognitive complexity (approximated as cyclomatic for TS/JS) |
| `halstead_effort` | `real` | NOT NULL, default 0 | Halstead effort (0 for Java) |
| `halstead_difficulty` | `real` | NOT NULL, default 0 | Halstead difficulty (0 for Java) |
| `halstead_volume` | `real` | NOT NULL, default 0 | Halstead volume (0 for Java) |
| `nesting_depth` | `integer` | NOT NULL, default 0 | Maximum nesting depth within this function |
| `created_at` | `text` | NOT NULL | ISO 8601 timestamp |

### 4.4 `code_health_events`

Audit log of analysis events — pre-commit checks, PR analyses, session completions, and background scans.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `text` | PRIMARY KEY | UUID |
| `event_type` | `text` | NOT NULL | `pre_commit_check` / `post_commit_analysis` / `pr_analysis` / `snapshot` / `session_check` |
| `file_path` | `text` | nullable | Target file or directory |
| `before_score` | `real` | nullable | Score before the change |
| `after_score` | `real` | nullable | Score after the change |
| `issues_found` | `integer` | NOT NULL, default 0 | Count of issues detected |
| `issues_resolved` | `integer` | NOT NULL, default 0 | Count of issues resolved since previous measurement |
| `iterations` | `integer` | NOT NULL, default 0 | Session iterations at time of event |
| `trigger` | `text` | NOT NULL, default `manual` | `manual` / `pre_commit` / `tool_read` / `hook` / `scheduled` |
| `context_json` | `text` | NOT NULL, default `{}` | Arbitrary context (tool name, PR number, session ID, etc.) |
| `created_at` | `text` | NOT NULL | ISO 8601 timestamp |

### 4.5 `code_health_sessions`

Represents a coaching session for an AI agent's self-improvement loop.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `text` | PRIMARY KEY | UUID |
| `workspace_id` | `text` | nullable | Associated workspace |
| `directory_path` | `text` | NOT NULL | Root directory of the session |
| `status` | `text` | NOT NULL, default `active` | `active` / `completed` / `failed` |
| `started_at` | `text` | NOT NULL | ISO 8601 timestamp |
| `completed_at` | `text` | nullable | ISO 8601 timestamp (null until closed) |
| `files_changed` | `text` | NOT NULL, default `[]` | JSON array of tracked absolute file paths |
| `initial_scores_json` | `text` | NOT NULL, default `{}` | `{ [filePath]: number }` — baseline scores at session start |
| `final_scores_json` | `text` | NOT NULL, default `{}` | `{ [filePath]: number }` — scores at session close |
| `total_iterations` | `integer` | NOT NULL, default 0 | Number of `session_check` calls made |
| `target_score` | `real` | NOT NULL, default 10 | Desired minimum score 1–10 |
| `achieved_target` | `integer` | NOT NULL, default 0 | `1` if target was reached, `0` otherwise |
| `max_iterations` | `integer` | NOT NULL, default 5 | Hard cap on iterations before auto-complete |
| `trigger` | `text` | NOT NULL, default `manual` | Trigger type |
| `created_at` | `text` | NOT NULL | ISO 8601 timestamp |

### 4.6 `code_health_background_jobs`

Tracks individual file analyses triggered by the background file access tracker.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | `text` | PRIMARY KEY | UUID |
| `file_path` | `text` | NOT NULL | Absolute path of the analyzed file |
| `workspace_id` | `text` | nullable | Associated workspace (if known) |
| `status` | `text` | NOT NULL, default `queued` | `queued` / `running` / `completed` / `failed` |
| `score` | `real` | nullable | Health score 1–10 (null until completed) |
| `grade` | `text` | nullable | `A`–`F` (null until completed) |
| `issue_count` | `integer` | NOT NULL, default 0 | Number of issues found |
| `issues_json` | `text` | NOT NULL, default `[]` | Serialized `HealthIssue[]` array |
| `trigger_tool` | `text` | NOT NULL | MCP tool name that triggered the analysis (e.g., `fs_read_file`) |
| `error_message` | `text` | nullable | Error detail if status is `failed` |
| `started_at` | `text` | nullable | ISO 8601 timestamp when worker picked up the job |
| `completed_at` | `text` | nullable | ISO 8601 timestamp when analysis finished |
| `created_at` | `text` | NOT NULL | ISO 8601 timestamp when job was created |

---

## 5. Scoring Algorithm

### 5.1 Signal Weights

Two weight sets exist depending on language. `SIGNAL_WEIGHTS` applies to TypeScript. `SIGNAL_WEIGHTS_NO_TYPES` applies to JavaScript and Java (the `typeSafety` weight is redistributed).

**TypeScript weights (`SIGNAL_WEIGHTS`):**

| Signal | Weight |
|---|---|
| `complexity` | 0.25 |
| `maintainability` | 0.20 |
| `duplication` | 0.15 |
| `functionSize` | 0.15 |
| `typeSafety` | 0.10 |
| `nestingDepth` | 0.08 |
| `parameterCount` | 0.07 |
| **Total** | **1.00** |

**JavaScript / Java weights (`SIGNAL_WEIGHTS_NO_TYPES`):**

| Signal | Weight |
|---|---|
| `complexity` | 0.30 |
| `maintainability` | 0.25 |
| `duplication` | 0.15 |
| `functionSize` | 0.15 |
| `typeSafety` | 0.00 (always scores 10) |
| `nestingDepth` | 0.08 |
| `parameterCount` | 0.07 |
| **Total** | **1.00** |

### 5.2 Piecewise Linear Interpolation

Every raw metric is mapped to a 1–10 signal score using one of two interpolation functions:

**`linearInterpolate(value, bestThreshold, worstThreshold)`**
Used for metrics where lower is better (e.g., cyclomatic complexity).
Returns `10` when `value <= bestThreshold`, `1` when `value >= worstThreshold`, and linearly interpolates between.

```
score = 10 - ((value - best) / (worst - best)) * 9
```

**`linearInterpolateInverted(value, bestThreshold, worstThreshold)`**
Used for metrics where higher is better (e.g., Maintainability Index, type coverage).
Returns `10` when `value >= bestThreshold`, `1` when `value <= worstThreshold`.

```
score = 1 + ((value - worst) / (best - worst)) * 9
```

### 5.3 Per-Signal Thresholds

| Signal | Raw metric | Best threshold | Worst threshold | Direction |
|---|---|---|---|---|
| `complexity` | Average cyclomatic complexity | 3 | 25 | lower is better |
| `maintainability` | Maintainability Index (0–171) | 85 | 20 | higher is better |
| `duplication` | Duplication % | 0% | 30% | lower is better |
| `functionSize` | Average function LOC | 15 | 100 | lower is better |
| `typeSafety` | Type coverage % | 100% | 50% | higher is better |
| `nestingDepth` | Max nesting depth | 2 | 8 | lower is better |
| `parameterCount` | Average parameter count | 2 | 7 | lower is better |

### 5.4 Overall Score

```
overall = sum(signal_score * weight for each signal)
overall = clamp(overall, 1, 10)
overall = round(overall, 2)
```

Directory score is the arithmetic mean of all file scores, clamped to 1–10.

### 5.5 Grade Mapping

| Score range | Grade |
|---|---|
| >= 8.5 | A |
| >= 7.0 | B |
| >= 5.0 | C |
| >= 3.0 | D |
| < 3.0 | F |

### 5.6 Per-Function Issue Thresholds

Issues are generated at both the signal level and the per-function level.

**Signal-level issue severity:**

| Signal score | Severity |
|---|---|
| < 3.0 | `critical` |
| 3.0 – 4.9 | `warning` |
| 5.0 – 6.9 | `info` |
| >= 7.0 | No issue generated |

**Per-function issue thresholds:**

| Condition | Severity |
|---|---|
| cyclomatic > 20 | `critical` |
| cyclomatic > 10 | `warning` |
| function LOC > 100 | `critical` |
| function LOC > 50 | `warning` |
| nesting depth > 4 | `warning` |
| parameter count > 4 | `warning` |

### 5.7 Hotspot Priority Formula

The hotspot priority score combines three normalized factors:

```
priorityScore =
  (1 - normalizedHealthScore) * 0.40   // low health = high priority
  + normalizedChurn * 0.35              // frequently changed = higher priority
  + normalizedBugFixRatio * 0.25        // bug-fix commits = higher priority
```

Where:
- `normalizedHealthScore = healthScore / 10`
- `normalizedChurn = commitCount / maxCommitCountInSet`
- `normalizedBugFixRatio = bugFixCommits / commitCount`

Bug-fix commits are identified by matching the commit subject against the pattern `\b(fix|bug|patch|hotfix)\b` (case-insensitive).

### 5.8 Java Maintainability Index

Java files do not have full Halstead metrics computed (no `typhonjs-escomplex` for Java). A simplified heuristic is used:

```
MI = 171 - 5.2 * ln(max(1, slocLogical))
         - 0.23 * avgCyclomatic
         - 16.2 * ln(max(1, avgFunctionLoc))
MI = clamp(MI, 0, 171)
```

---

## 6. MCP Tools

All 13 tools are registered unconditionally at server startup. Tool names are prefixed with `code_health_`.

---

### Tool 1: `code_health_analyze_file`

**Description:** Analyze a single file's code health. Returns a 1–10 score with 7-signal breakdown, per-function metrics, and improvement suggestions with line numbers.

**Input:**
```typescript
{
  filePath: string            // Absolute path to the file
  includePerFunctionMetrics?: boolean  // default: true
  includeSuggestions?: boolean         // default: true
}
```

**Output:** `FileHealthReport` — serialized JSON containing `filePath`, `language`, `score` (overall, breakdown, grade, issues), `metrics` (all AST metrics), and optionally `functions`.

**Side effect:** Persists a completed record to `code_health_background_jobs` for UI visibility.

---

### Tool 2: `code_health_analyze_directory`

**Description:** Analyze all supported files in a directory. Returns aggregate score, grade distribution, worst offenders, and per-file reports.

**Input:**
```typescript
{
  directoryPath: string       // Absolute path
  workspaceId?: string        // Alternative to directoryPath
  recursive?: boolean         // default: true
  extensions?: string[]       // default: [".ts", ".tsx", ".js", ".jsx", ".java"]
  maxFiles?: number           // default: 200
  skipPatterns?: string[]     // default: ["node_modules", "dist", ".git", "build", "coverage"]
}
```

**Output:** `DirectoryHealthReport` — aggregate score, grade, file count, total LOC, total functions, per-file reports, worst offenders (bottom 10 by score), and grade distribution histogram.

---

### Tool 3: `code_health_snapshot`

**Description:** Take a full project health snapshot and persist to the database. Establishes baselines for trend tracking. Returns the snapshot ID, aggregate score, file count, and comparison with the previous snapshot.

**Input:**
```typescript
{
  directoryPath: string
  workspaceId?: string
  label?: string              // e.g., "v1.2.0"
  extensions?: string[]
  skipPatterns?: string[]
}
```

**Output:** `{ snapshotId, overallScore, grade, fileCount, totalLoc, totalFunctions, gitRef, label, previousScore, scoreDelta, previousGrade }`

**Side effects:** Creates one row in `code_health_snapshots`, N rows in `code_health_file_metrics`, and M rows in `code_health_function_metrics`. Resolves current git HEAD SHA via `git rev-parse HEAD`.

---

### Tool 4: `code_health_trends`

**Description:** Query historical health scores for trend analysis. Reports trend direction and rate of change.

**Input:**
```typescript
{
  targetPath: string          // File or directory path
  scope?: "file" | "directory"   // default: "directory"
  period?: "7d" | "30d" | "90d" | "all"  // default: "30d"
  granularity?: "daily" | "weekly" | "monthly"  // default: "weekly"
}
```

**Output:** `HealthTrendReport` — `targetPath`, `period`, `dataPoints[]` (date, score, grade, fileCount), `trendDirection`, `rateOfChange`, `currentScore`, `previousScore`.

---

### Tool 5: `code_health_hotspots`

**Description:** Identify refactoring hotspots by combining git change frequency, bug-fix correlation, and health score. Files that change often AND have low health are the highest-priority targets.

**Input:**
```typescript
{
  directoryPath: string
  lookbackDays?: number       // default: 90
  topN?: number               // default: 20
  gitBranch?: string          // optional
}
```

**Output:** `{ directoryPath, lookbackDays, totalFilesAnalyzed, hotspotsFound, hotspots[] }` where each hotspot contains `filePath`, `healthScore`, `churnScore`, `bugFixRatio`, `priorityScore`, `commitCount`, `uniqueAuthors`.

---

### Tool 6: `code_health_pre_commit_check`

**Description:** Quality gate for code changes. Analyzes specified files against a snapshot baseline. Returns pass/fail with blocking issues and fix suggestions.

**Input:**
```typescript
{
  directoryPath: string
  filePaths: string[]         // min 1
  maxAllowedRegression?: number  // default: 0.5 (score points)
  requireMinScore?: number    // optional absolute floor
}
```

**Output:** `PreCommitResult` — `{ pass, filesChecked, fileVerdicts[], blockingIssues[], suggestions[] }`.

**Side effect:** Writes a `pre_commit_check` event to `code_health_events`.

---

### Tool 7: `code_health_analyze_pr`

**Description:** Analyze the code health impact of a GitHub pull request. Fetches changed files via GitHub API, analyzes each locally, and produces a markdown-formatted before/after summary.

**Input:**
```typescript
{
  owner: string
  repo: string
  prNumber: number
  failOnRegression?: boolean      // default: false
  regressionThreshold?: number    // default: 0.5
}
```

**Output:** `{ pr, overallScore, pass, filesAnalyzed, filesTotal, fileResults[], regressionCount, markdownSummary }`.

**Side effect:** Writes a `pr_analysis` event to `code_health_events`.

---

### Tool 8: `code_health_start_session`

**Description:** Start a coding session to track quality changes over multiple iterations. Auto-detects changed files via `git diff --name-only HEAD` (falls back to staged changes). Returns session ID and baseline scores.

**Input:**
```typescript
{
  directoryPath: string
  filePaths?: string[]        // If omitted, auto-detects via git diff
  targetScore?: number        // default: 10
  maxIterations?: number      // default: 5
}
```

**Output:** `{ sessionId, filesTracked[], baselineScores, targetScore, maxIterations }`.

**Side effect:** Creates a row in `code_health_sessions`.

---

### Tool 9: `code_health_session_check`

**Description:** Re-analyze all tracked files in an active session. Updates iteration count and scores. Indicates whether the target score has been reached.

**Input:**
```typescript
{
  sessionId: string
}
```

**Output:** `{ sessionId, iteration, filesAnalyzed, scores, targetScore, targetReached, improvements[], regressions[], summary }`.

**Side effects:** Updates `total_iterations` in `code_health_sessions`. Writes a `session_check` event.

---

### Tool 10: `code_health_end_session`

**Description:** Complete an active session and persist final scores.

**Input:**
```typescript
{
  sessionId: string
}
```

**Output:** `{ sessionId, status, initialScores, finalScores, totalIterations, achievedTarget, summary }`.

**Side effects:** Sets `status = "completed"`, `completed_at`, and `final_scores_json` in `code_health_sessions`. Writes a final `session_check` event.

---

### Tool 11: `code_health_function_ranking`

**Description:** Rank functions across a file or directory by a chosen metric. Useful for finding the most complex or largest functions to refactor first.

**Input:**
```typescript
{
  targetPath: string
  sortBy?: "cyclomatic" | "cognitive" | "halstead_effort" | "loc" | "parameter_count"  // default: "cognitive"
  limit?: number              // default: 50
  minThreshold?: number       // optional — filter out trivial functions
}
```

**Output:** Ranked list of function metrics from the latest snapshot, including file path, function name, line range, and all metric values.

---

### Tool 12: `code_health_duplication`

**Description:** Detect code duplication and near-clones within a directory using token-based analysis via `jscpd`.

**Input:**
```typescript
{
  directoryPath: string
  minTokens?: number          // default: 50
  minLines?: number           // default: 6
  extensions?: string[]       // default: [".ts", ".tsx", ".js", ".jsx", ".java"]
}
```

**Output:** `DuplicationReport` — `{ directoryPath, totalFiles, totalLines, duplicatedLines, duplicationPercentage, clones[] }`.

**Implementation note:** Invokes `npx jscpd` with JSON output to a temp directory, reads the report, then cleans up. The tool tolerates a non-zero `jscpd` exit code (expected when clones are found) and only treats it as an error if the report file is absent.

---

### Tool 13: `code_health_type_coverage`

**Description:** Analyze TypeScript type safety: count `any` usages, missing return type annotations, and type assertion density. Coverage percentage is estimated from annotation density vs. `any` occurrence ratio.

**Input:**
```typescript
{
  targetPath: string          // Must be a .ts or .tsx file
  tsconfigPath?: string       // Optional (not currently used)
}
```

**Output:** `TypeCoverageReport` — `{ filePath, coveragePercentage, anyCount, implicitAnyLocations[], missingReturnTypes[], typeAssertionCount }`.

**Implementation note:** Uses regex-based static inspection (not the TypeScript compiler API). Comments and string literals are stripped before matching to reduce false positives.

---

## 7. REST API Endpoints

All endpoints are served by the Hono HTTP app on the admin port. Base path: `/api/code-health`.

### GET /api/code-health/projects

Returns all registered workspaces as code health projects, each enriched with the latest snapshot score and scanned file count.

**Response:** `CodeHealthProject[]`
```json
[
  {
    "id": "workspace-uuid",
    "name": "my-repo",
    "directoryPath": "/Users/me/code/my-repo",
    "latestScore": 7.42,
    "latestGrade": "B",
    "fileCount": 34,
    "lastAnalyzedAt": "2026-05-09T10:00:00Z"
  }
]
```

---

### GET /api/code-health/projects/:id

Returns a single project with its most recent full snapshot.

**Response:** `{ project: CodeHealthProject, snapshot: CodeHealthSnapshot | null }`

---

### GET /api/code-health/projects/:id/trends

Returns snapshot history for a project as a time-series array (oldest first).

**Response:** `Array<{ date: string, score: number, grade: string, fileCount: number }>`

---

### GET /api/code-health/snapshots/:id/files

Returns all file metrics belonging to a specific snapshot.

**Response:** `CodeHealthFileMetric[]`

---

### GET /api/code-health/files/:id/functions

Returns all function metrics for a specific file metric row.

**Response:** function metric rows

---

### GET /api/code-health/projects/:id/events

Returns the 50 most recent code health events (across all files, not filtered to this project's directory).

**Response:** `CodeHealthEvent[]`

---

### GET /api/code-health/sessions

Returns the 50 most recent sessions.

**Response:** `CodeHealthSession[]`

---

### GET /api/code-health/background-jobs

Returns the 50 most recent background analysis jobs.

**Response:** `BackgroundJob[]`

---

### GET /api/code-health/background-jobs/active

Returns the count of jobs currently queued or in-flight in the `FileAccessTracker`.

**Response:** `{ count: number }`

---

### GET /api/code-health/projects/:id/scanned-files

Returns all completed background analysis jobs for all folders belonging to the workspace, deduplicated by file path (latest scan per file is kept).

**Response:** `Array<{ id, filePath, score, grade, issueCount, issuesJson, triggerTool, completedAt, createdAt }>`

---

### POST /api/code-health/projects/:id/snapshot

Triggers an on-demand directory analysis and persists a new snapshot. Used by the "Analyze Now" button in the admin panel.

**Request body:** `{}` (empty)

**Response:** `{ snapshotId: string }` — HTTP 500 if analysis fails.

---

## 8. Frontend Components

### Routes

| Route | Component | Description |
|---|---|---|
| `/code-health` | `CodeHealthProjectsPage` | Grid of workspace cards with latest score, file count, and "Analyze Now" button. Includes a `BackgroundActivityFeed` below. |
| `/code-health/:projectId` | `CodeHealthProjectDetailPage` | Project detail: stats strip, trend chart, scanned files list, issues grouped by file, recent events list. |

### Shared Components

| Component | File | Description |
|---|---|---|
| `HealthScoreBadge` | `src/frontend/components/health-score-badge.tsx` | Circular SVG badge showing the numeric score and letter grade. Color-coded by grade (green A, yellow-green B, amber C, orange D, red F). Used on both project cards (size 40) and detail header (size 56). |
| `HealthTrendChart` | `src/frontend/components/health-trend-chart.tsx` | SVG line chart rendering historical score trend. Accepts `dataPoints[]` and explicit `width`/`height` props. Shown on the detail page when 2+ snapshots exist. |

### TanStack Query Hooks

All hooks are defined in `src/frontend/api/code-health.api.ts`. Query keys are defined in `src/frontend/api/query-keys.ts` under the `codeHealthKeys` namespace.

| Hook | Query key | Endpoint | Poll interval |
|---|---|---|---|
| `useCodeHealthProjects()` | `codeHealthKeys.projects()` | `GET /api/code-health/projects` | None |
| `useCodeHealthProject(id)` | `codeHealthKeys.project(id)` | `GET /api/code-health/projects/:id` | None |
| `useCodeHealthTrends(id)` | `codeHealthKeys.trends(id)` | `GET /api/code-health/projects/:id/trends` | None |
| `useCodeHealthFiles(snapshotId)` | `codeHealthKeys.files(snapshotId)` | `GET /api/code-health/snapshots/:id/files` | None |
| `useCodeHealthSessions()` | `codeHealthKeys.sessions()` | `GET /api/code-health/sessions` | None |
| `useCodeHealthEvents(id)` | `codeHealthKeys.events(id)` | `GET /api/code-health/projects/:id/events` | None |
| `useBackgroundJobs()` | `codeHealthKeys.backgroundJobs()` | `GET /api/code-health/background-jobs` | 10 s |
| `useProjectScannedFiles(id)` | `codeHealthKeys.scannedFiles(id)` | `GET /api/code-health/projects/:id/scanned-files` | 15 s |
| `useActiveBackgroundJobCount()` | `codeHealthKeys.backgroundJobsActive()` | `GET /api/code-health/background-jobs/active` | 10 s |
| `useTriggerSnapshot()` | mutation | `POST /api/code-health/projects/:id/snapshot` | Invalidates `codeHealthKeys.all` on success |

---

## 9. Background Analysis System

### Flow Diagram

```
MCP Client calls fs_read_file
       |
       v
trackedFsService.readFile(folderId, relativePath)
  — wraps localFilesystemService.readFile
  — on Ok result, fires:
       |
       v
_fileAccessTracker.recordFileRead(absolutePath, "fs_read_file")
       |
       +-- is extension supported? (.ts/.tsx/.js/.jsx/.java)
       |     No → return (discard)
       |     Yes → continue
       |
       +-- is queue already at 200? → return (discard)
       |
       +-- is file already in queue? → return (deduplicate)
       |
       v
queue.push({ filePath, triggerTool })

setInterval(2000ms):
       |
       v
processQueue()
  — for each item in queue:
       |
       v
backgroundJobsRepo.findRecentByFilePath(filePath, sinceIso)
  — sinceIso = now - 24h
       |
       +-- recent job found? → skip (debounce)
       |
       v
backgroundJobsRepo.create({ filePath, triggerTool, status: "queued" })
backgroundJobsRepo.update(id, { status: "running", startedAt })
       |
       v
codeHealthService.analyzeFile(filePath)
       |
       +-- Ok → backgroundJobsRepo.update({ status: "completed", score, grade, issueCount, issuesJson })
       |         eventsRepo.create({ eventType: "post_commit_analysis", ... })
       |
       +-- Err → backgroundJobsRepo.update({ status: "failed", errorMessage })
```

### Key Constants

| Constant | Value | Description |
|---|---|---|
| `DEBOUNCE_HOURS` | 24 | Hours before a file can be re-analyzed |
| `WORKER_INTERVAL_MS` | 2,000 | Milliseconds between worker ticks |
| `MAX_QUEUE_SIZE` | 200 | Maximum number of items in the in-memory queue |
| `SUPPORTED_EXTENSIONS` | `.ts`, `.tsx`, `.js`, `.jsx`, `.java` | Extensions eligible for background analysis |

### Service-Layer Interception

The interception is implemented in `server.ts` using `Object.create` to wrap the `localFilesystemService` without mutating it:

```typescript
const trackedFsService = Object.create(localFilesystemService, {
  readFile: {
    value: async (...args) => {
      const result = await localFilesystemService.readFile(...args);
      if (result._tag === "Ok" && result.value.absolute_path) {
        _fileAccessTracker?.recordFileRead(result.value.absolute_path, "fs_read_file");
      }
      return result;
    },
  },
});
```

A deferred reference (`_fileAccessTracker`) is used because the `FileAccessTracker` is created after the filesystem tools are registered. The reference is set immediately after `createFileAccessTracker` is called.

---

## 10. Integration Points

### GitHub PR Review Integration

The `code_health_analyze_pr` tool depends on `GitHubService.getPullRequestFiles(owner, repo, prNumber)`. This method must exist on the GitHub service. The tool assumes the PR's changed files are checked out locally and uses their absolute paths directly for analysis. Files with status `removed` are skipped.

### Workspace / Folder Access Integration

The REST API endpoints for projects map directly onto `repoWorkspacesTable` (workspaces) and `folderAccessTable` (registered folder paths). The background tracker fires only on files returned by `localFilesystemService.readFile`, which itself enforces the folder access registry. This means background analysis is scoped automatically to registered folders.

### Existing MCP Tool Hooks

The background tracker intercepts results from the `fs_read_file` MCP tool only. Other filesystem tools (`fs_list_directory`, `fs_search_files`, `fs_get_file_tree`) do not trigger background analysis. The `code_health_analyze_file` tool also writes a record to `code_health_background_jobs` on success (for UI visibility), bypassing the 24-hour debounce since it is an explicit user-initiated call.

### Snapshot Tool and Session Tool

The `code_health_snapshot` tool resolves the current git HEAD SHA synchronously via `execSync("git rev-parse HEAD")`. The `code_health_start_session` tool resolves changed files synchronously via `execSync("git diff --name-only HEAD")`. Both tolerate failure gracefully (non-git directories proceed without the data).

---

## 11. Technology Stack

### NPM Packages

| Package | Role |
|---|---|
| `typhonjs-escomplex` | AST-based complexity analysis for TypeScript and JavaScript. Provides cyclomatic complexity, Halstead metrics (effort, difficulty, volume, bugs), logical SLOC, and Maintainability Index per module and per method. Used via `escomplex.analyzeModule(source, options)`. No type declarations — imported with `@ts-expect-error`. |
| `java-parser` | Concrete Syntax Tree (CST) parser for Java source. Used to extract method declarations and constructors, count complexity tokens, estimate nesting depth, and compute line ranges. The CST is walked manually (no visitor API) via recursive `collectNodes` and `countTokenImages` helpers. |
| `jscpd` (via `npx`) | Token-based copy-paste detection for duplication analysis. Not a runtime dependency — invoked via `npx jscpd` with `--reporters json --silent --output <tmpdir>`. The JSON report is read and mapped to the `DuplicationReport` schema. |
| `drizzle-orm` + `better-sqlite3` | ORM and SQLite driver for all persistence. Tables defined in `src/backend/db/schema.ts`. All queries via typed repository functions. |
| `zod` | Schema definition and runtime validation for all tool inputs and domain types. All tool inputs are validated with `Schema.parse(args)` before processing. |
| `pino` | Structured JSON logging. Used in every service and repository via the injected `logger` dependency. |

### AST Parsing Approach Per Language

**TypeScript / JavaScript:**
`typhonjs-escomplex` internally uses `@typescript-eslint/parser` for TypeScript and `babel-eslint` for JavaScript. The library is called once per file via `escomplex.analyzeModule(source, { commonjs: true, logicalor: true, switchcase: true })`. The result contains per-method metrics and aggregate module metrics including Maintainability Index.

Known limitation: `escomplex` reports `nestingDepth = 0` for all functions (the library does not track nesting). The nesting depth signal is therefore always 10 for TypeScript and JavaScript files unless overridden by a future parser upgrade.

**Java:**
`java-parser` produces a CST. The following approach is used:
- Method declarations (`methodDeclaration`) and constructors (`constructorDeclaration`) are extracted via recursive CST walking.
- Cyclomatic complexity is approximated by counting branch tokens: `if`, `for`, `while`, `switch`, `case`, `catch`, `&&`, `||` — plus 1.
- Nesting depth is computed by tracking depth increments at CST nodes named `ifStatement`, `forStatement`, `whileStatement`, `doWhileStatement`, `switchStatement`, `tryStatement`, `lambdaExpression`.
- Halstead metrics are not computed for Java (all default to 0).
- Cognitive complexity is approximated as equal to cyclomatic complexity.

---

## 12. Future Enhancements

### Adaptive Learning from Events

The `code_health_events` table already captures before/after scores, trigger type, and context JSON. A future enhancement could analyze this history to detect which signals most commonly improve (or regress) for a given codebase or team, and dynamically adjust signal weights as a per-project override stored in `server_settings`.

### ESLint Integration

ESLint produces structured JSON output with rule violations, counts, and severity. The type coverage signal could be replaced or augmented with actual ESLint `@typescript-eslint/no-explicit-any` rule counts. The signal infrastructure is already weight-configurable; ESLint data would simply feed a different scoring input.

### More Language Support

The `SupportedLanguage` type is a Zod enum with entries for TypeScript, JavaScript, and Java. Adding Python (via `radon` or `pyflakes`) or Go (via `gocyclo`) would require:
1. Adding the extension to `SUPPORTED_EXTENSIONS`
2. Adding a new branch in `AstAnalysisService.analyzeFile`
3. Updating `SIGNAL_WEIGHTS_NO_TYPES` for weight redistribution

The scoring and persistence layers would require no changes.

### Scheduled Workspace Snapshots

The `MaintenanceScheduler` already supports periodic tasks (used for transcript sync). A scheduled code health snapshot task could run nightly for all registered workspaces, ensuring the trend chart always has recent data even without explicit MCP tool calls.

### Nesting Depth for TypeScript/JavaScript

`typhonjs-escomplex` does not compute nesting depth. A complementary pass using the TypeScript compiler API (`ts.createSourceFile` + AST walking) could fill this gap and improve the accuracy of the `nestingDepth` signal for TS/JS files.

### Per-File Baseline in Pre-Commit Checks

The current `code_health_pre_commit_check` implementation uses the most recent snapshot's overall directory score as the baseline for all files. A future improvement would store and look up per-file baseline scores from `code_health_file_metrics` so regressions are measured against each individual file's historical score rather than a directory aggregate.
