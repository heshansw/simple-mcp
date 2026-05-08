import { execSync } from "node:child_process";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import { StartSessionInputSchema, ALL_SUPPORTED_EXTENSIONS } from "@shared/schemas/code-health.schema.js";
import type { CodeHealthService } from "../../services/code-health/code-health.service.js";
import type { CodeHealthSessionsRepository } from "../../db/repositories/code-health-sessions.repository.js";

export type StartSessionToolDeps = {
  codeHealthService: CodeHealthService;
  sessionsRepo: CodeHealthSessionsRepository;
  logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
};

function detectChangedFiles(directoryPath: string): string[] {
  const supportedSet = new Set(ALL_SUPPORTED_EXTENSIONS);

  const tryGitDiff = (command: string): string[] => {
    try {
      const output = execSync(command, { cwd: directoryPath, encoding: "utf-8" });
      return output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => supportedSet.has(line.slice(line.lastIndexOf("."))));
    } catch {
      return [];
    }
  };

  // Try unstaged changes first
  const unstaged = tryGitDiff("git diff --name-only HEAD");
  if (unstaged.length > 0) return unstaged;

  // Fall back to staged changes
  return tryGitDiff("git diff --name-only --cached HEAD");
}

export function registerStartSessionTool(server: McpServer, deps: StartSessionToolDeps): void {
  server.tool(
    "code_health_start_session",
    "Start a coding session to track code quality changes. Auto-detects changed files via git diff or accepts explicit file paths. Returns session ID and baseline scores.",
    StartSessionInputSchema.shape,
    async (args) => {
      try {
        const input = StartSessionInputSchema.parse(args);
        const { directoryPath, targetScore, maxIterations } = input;

        deps.logger.info("Starting code health session", { directoryPath, targetScore, maxIterations });

        // Resolve file paths
        let filePaths = input.filePaths ?? [];
        if (filePaths.length === 0) {
          filePaths = detectChangedFiles(directoryPath);
        }

        if (filePaths.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "Error: No changed files detected. Provide explicit filePaths or ensure there are uncommitted changes in the working directory.",
            }],
            isError: true,
          };
        }

        // Resolve to absolute paths
        filePaths = filePaths.map((fp) => resolve(directoryPath, fp));

        // Analyze each file for baseline scores
        const scores: Record<string, number> = {};
        for (const filePath of filePaths) {
          const result = await deps.codeHealthService.analyzeFile(filePath, {
            includeSuggestions: false,
            includePerFunctionMetrics: false,
          });
          if (isErr(result)) {
            deps.logger.error("Failed to analyze file for baseline", { filePath, error: domainErrorMessage(result.error) });
            continue;
          }
          scores[filePath] = result.value.score.overall;
        }

        // Only track files that were successfully analyzed
        const trackedFiles = Object.keys(scores);
        if (trackedFiles.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "Error: Could not analyze any of the target files. Ensure they exist and are supported file types.",
            }],
            isError: true,
          };
        }

        // Create session record
        const session = await deps.sessionsRepo.create({
          directoryPath,
          filesChanged: JSON.stringify(trackedFiles),
          initialScoresJson: JSON.stringify(scores),
          finalScoresJson: "{}",
          targetScore,
          maxIterations,
          totalIterations: 0,
          status: "active",
          startedAt: new Date().toISOString(),
          achievedTarget: 0,
          trigger: "manual",
          workspaceId: null,
        });

        const result = {
          sessionId: session.id,
          filesTracked: trackedFiles,
          baselineScores: scores,
          targetScore,
          maxIterations,
        };

        deps.logger.info("Code health session started", { sessionId: session.id, filesTracked: trackedFiles.length });

        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
