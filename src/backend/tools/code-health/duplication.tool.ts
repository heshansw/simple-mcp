import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DuplicationInputSchema } from "@shared/schemas/code-health.schema.js";
import type { ClonePair, DuplicationReport } from "@shared/schemas/code-health.schema.js";

const execFileAsync = promisify(execFile);

// ── Types ──────────────────────────────────────────────────────────────

export type DuplicationToolDeps = {
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

// ── jscpd report types (subset of what jscpd outputs) ──────────────────

type JscpdDuplicate = {
  firstFile: { name: string; startLoc: { line: number }; endLoc: { line: number } };
  secondFile: { name: string; startLoc: { line: number }; endLoc: { line: number } };
  lines: number;
  tokens: number;
};

type JscpdStatistics = {
  total: { lines: number; sources: number; clones: number; duplicatedLines: number; percentage: number };
};

type JscpdReport = {
  duplicates: ReadonlyArray<JscpdDuplicate>;
  statistics: JscpdStatistics;
};

// ── Registration ───────────────────────────────────────────────────────

export function registerDuplicationTool(
  server: McpServer,
  deps: DuplicationToolDeps,
): void {
  server.tool(
    "code_health_duplication",
    "Detect code duplication and near-clones within a directory using token-based analysis.",
    DuplicationInputSchema.shape,
    async (args) => {
      const tmpDir = join(tmpdir(), `jscpd-${randomUUID()}`);

      try {
        const input = DuplicationInputSchema.parse(args);
        deps.logger.info("Running duplication analysis", {
          dir: input.directoryPath,
          minTokens: input.minTokens,
          minLines: input.minLines,
        });

        // Create temp output directory
        await mkdir(tmpDir, { recursive: true });

        // Build extension pattern for jscpd format filter
        const formatArgs: string[] = [];
        for (const ext of input.extensions) {
          // jscpd uses format names like "typescript", "javascript", "java"
          // but also accepts glob patterns via --pattern
          formatArgs.push("--ignore", `"!**/*${ext}"`);
        }

        // Run jscpd via npx
        const jscpdArgs = [
          "jscpd",
          input.directoryPath,
          "--min-tokens",
          String(input.minTokens),
          "--min-lines",
          String(input.minLines),
          "--reporters",
          "json",
          "--silent",
          "--output",
          tmpDir,
          "--ignore",
          '"**/node_modules/**,**/dist/**,**/.git/**,**/build/**,**/coverage/**"',
        ];

        try {
          await execFileAsync("npx", jscpdArgs, {
            cwd: input.directoryPath,
            maxBuffer: 10 * 1024 * 1024,
            timeout: 120_000,
          });
        } catch (execError) {
          // jscpd exits with non-zero when duplicates are found — that's expected
          // Only treat as real error if the report file doesn't exist
          deps.logger.info("jscpd exited (may have found duplicates)", {
            error: execError instanceof Error ? execError.message : String(execError),
          });
        }

        // Read the JSON report
        const reportPath = join(tmpDir, "jscpd-report.json");
        let reportJson: string;
        try {
          reportJson = await readFile(reportPath, "utf-8");
        } catch {
          return {
            content: [{
              type: "text" as const,
              text: "Error: jscpd did not produce a report. Ensure jscpd is installed (npx jscpd) and the directory contains supported files.",
            }],
            isError: true,
          };
        }

        const rawReport = JSON.parse(reportJson) as JscpdReport;

        // Transform to our schema
        const clones: ClonePair[] = (rawReport.duplicates ?? []).map((dup) => ({
          fileA: dup.firstFile.name,
          startLineA: dup.firstFile.startLoc.line,
          endLineA: dup.firstFile.endLoc.line,
          fileB: dup.secondFile.name,
          startLineB: dup.secondFile.startLoc.line,
          endLineB: dup.secondFile.endLoc.line,
          lines: dup.lines,
          tokens: dup.tokens,
        }));

        const stats = rawReport.statistics?.total;
        const report: DuplicationReport = {
          directoryPath: input.directoryPath,
          totalFiles: stats?.sources ?? 0,
          totalLines: stats?.lines ?? 0,
          duplicatedLines: stats?.duplicatedLines ?? 0,
          duplicationPercentage: stats?.percentage ?? 0,
          clones,
        };

        deps.logger.info("Duplication analysis complete", {
          clones: clones.length,
          percentage: report.duplicationPercentage,
        });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          }],
          isError: true,
        };
      } finally {
        // Clean up temp directory
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {
          /* ignore cleanup errors */
        });
      }
    },
  );
}
