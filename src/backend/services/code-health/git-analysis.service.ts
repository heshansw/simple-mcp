import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { Result } from "@shared/result.js";
import { ok, err, integrationError } from "@shared/result.js";
import type { DomainError } from "@shared/result.js";
import type { FileChurnInfo } from "@shared/schemas/code-health.schema.js";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────

export type GitAnalysisDeps = {
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export type GitAnalysisService = {
  getFileChurn(
    directoryPath: string,
    lookbackDays: number,
  ): Promise<Result<ReadonlyArray<FileChurnInfo>, DomainError>>;
};

// ── Internal helpers ───────────────────────────────────────────────────

type CommitBlock = {
  hash: string;
  author: string;
  subject: string;
  date: string;
  files: string[];
};

const BUG_FIX_PATTERN = /\b(fix|bug|patch|hotfix)\b/i;

function parseCommitBlocks(stdout: string): ReadonlyArray<CommitBlock> {
  const blocks: CommitBlock[] = [];
  const lines = stdout.split("\n");

  let current: CommitBlock | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      // Empty line separates commit blocks
      continue;
    }

    // Header line: hash|author|date|subject
    if (trimmed.includes("|")) {
      const parts = trimmed.split("|");
      if (parts.length >= 4) {
        current = {
          hash: parts[0] ?? "",
          author: parts[1] ?? "",
          date: parts[2] ?? "",
          subject: parts.slice(3).join("|"),
          files: [],
        };
        blocks.push(current);
        continue;
      }
    }

    // File name line — belongs to current commit
    if (current && trimmed.length > 0) {
      current.files.push(trimmed);
    }
  }

  return blocks;
}

type NumstatEntry = {
  filePath: string;
  added: number;
  deleted: number;
};

function parseNumstat(stdout: string): ReadonlyArray<NumstatEntry> {
  const entries: NumstatEntry[] = [];
  const lines = stdout.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // numstat format: added\tdeleted\tfilepath
    const parts = trimmed.split("\t");
    if (parts.length >= 3) {
      const added = parseInt(parts[0] ?? "0", 10);
      const deleted = parseInt(parts[1] ?? "0", 10);
      const filePath = parts[2] ?? "";

      // Binary files show "-" for added/deleted
      if (!isNaN(added) && !isNaN(deleted) && filePath.length > 0) {
        entries.push({ filePath, added, deleted });
      }
    }
  }

  return entries;
}

// ── Factory ────────────────────────────────────────────────────────────

export function createGitAnalysisService(deps: GitAnalysisDeps): GitAnalysisService {
  const { logger } = deps;

  async function getFileChurn(
    directoryPath: string,
    lookbackDays: number,
  ): Promise<Result<ReadonlyArray<FileChurnInfo>, DomainError>> {
    try {
      const since = `${lookbackDays} days ago`;

      // Step 1: Get commit blocks with file names
      const { stdout: commitStdout } = await execFileAsync(
        "git",
        [
          "log",
          `--since=${since}`,
          "--name-only",
          "--pretty=format:%H|%an|%aI|%s",
          "--",
          ".",
        ],
        { cwd: directoryPath, maxBuffer: 10 * 1024 * 1024 },
      );

      const commitBlocks = parseCommitBlocks(commitStdout);

      if (commitBlocks.length === 0) {
        logger.info("No commits found in lookback period", { directoryPath, lookbackDays });
        return ok([]);
      }

      // Step 2: Get numstat for lines added/deleted
      const { stdout: numstatStdout } = await execFileAsync(
        "git",
        [
          "log",
          `--since=${since}`,
          "--numstat",
          "--pretty=format:",
          "--",
          ".",
        ],
        { cwd: directoryPath, maxBuffer: 10 * 1024 * 1024 },
      );

      const numstatEntries = parseNumstat(numstatStdout);

      // Step 3: Aggregate per-file metrics from commit blocks
      const fileMap = new Map<
        string,
        {
          commitCount: number;
          authors: Set<string>;
          bugFixCommits: number;
          lastModified: string;
        }
      >();

      for (const block of commitBlocks) {
        for (const filePath of block.files) {
          const existing = fileMap.get(filePath);

          if (existing) {
            existing.commitCount += 1;
            existing.authors.add(block.author);
            if (BUG_FIX_PATTERN.test(block.subject)) {
              existing.bugFixCommits += 1;
            }
            // Keep the most recent date (blocks are in reverse chronological order)
            if (!existing.lastModified || block.date > existing.lastModified) {
              existing.lastModified = block.date;
            }
          } else {
            fileMap.set(filePath, {
              commitCount: 1,
              authors: new Set([block.author]),
              bugFixCommits: BUG_FIX_PATTERN.test(block.subject) ? 1 : 0,
              lastModified: block.date,
            });
          }
        }
      }

      // Step 4: Aggregate numstat per file
      const lineStatsMap = new Map<string, { added: number; deleted: number }>();
      for (const entry of numstatEntries) {
        const existing = lineStatsMap.get(entry.filePath);
        if (existing) {
          existing.added += entry.added;
          existing.deleted += entry.deleted;
        } else {
          lineStatsMap.set(entry.filePath, { added: entry.added, deleted: entry.deleted });
        }
      }

      // Step 5: Combine into FileChurnInfo array
      const now = Date.now();
      const results: FileChurnInfo[] = [];

      for (const [filePath, data] of fileMap) {
        const lineStats = lineStatsMap.get(filePath);
        const lastModifiedDate = data.lastModified
          ? new Date(data.lastModified)
          : new Date();
        const ageInDays = Math.max(
          0,
          Math.floor((now - lastModifiedDate.getTime()) / (1000 * 60 * 60 * 24)),
        );

        results.push({
          filePath,
          commitCount: data.commitCount,
          uniqueAuthors: data.authors.size,
          bugFixCommits: data.bugFixCommits,
          lastModified: data.lastModified || new Date().toISOString(),
          ageInDays,
          linesAdded: lineStats?.added ?? 0,
          linesDeleted: lineStats?.deleted ?? 0,
        });
      }

      // Sort by commit count descending
      results.sort((a, b) => b.commitCount - a.commitCount);

      logger.info("Git churn analysis complete", {
        directoryPath,
        filesAnalyzed: results.length,
        totalCommits: commitBlocks.length,
      });

      return ok(results);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Git analysis failed", { directoryPath, error: message });
      return err(
        integrationError(
          "git",
          `Failed to analyze git history: ${message}`,
        ),
      );
    }
  }

  return { getFileChurn };
}
