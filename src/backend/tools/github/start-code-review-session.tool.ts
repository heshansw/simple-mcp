import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import {
  StartCodeReviewSessionInputSchema,
} from "@shared/schemas/code-review.schema.js";
import type { RepoReviewConfigsRepository } from "../../db/repositories/repo-review-configs.repository.js";
import type { CodeReviewSessionsRepository } from "../../db/repositories/code-review-sessions.repository.js";

export type StartCodeReviewSessionToolDeps = {
  repoReviewConfigsRepo: RepoReviewConfigsRepository;
  codeReviewSessionsRepo: CodeReviewSessionsRepository;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
  };
};

const DIFF_SIZE_LIMIT = 524288; // 500 KB
const DIFF_TIMEOUT_MS = 30000;
const REMOTE_TIMEOUT_MS = 5000;

function parseDiffStats(diffContent: string): { filesChanged: number; additions: number; deletions: number } {
  let filesChanged = 0;
  let additions = 0;
  let deletions = 0;

  try {
    const lines = diffContent.split("\n");
    for (const line of lines) {
      if (line.startsWith("diff --git")) {
        filesChanged++;
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        additions++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        deletions++;
      }
    }
  } catch {
    // If parsing fails, return zeros per spec
  }

  return { filesChanged, additions, deletions };
}

function extractOwnerRepo(repoPath: string): { owner: string; repo: string } | null {
  try {
    const result = spawnSync("git", ["remote", "get-url", "origin"], {
      cwd: repoPath,
      timeout: REMOTE_TIMEOUT_MS,
      maxBuffer: 1024 * 64,
    });

    if (result.status !== 0 || !result.stdout) {
      return null;
    }

    const url = result.stdout.toString().trim();

    // SSH format: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@[^:]+:([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (sshMatch && sshMatch[1] && sshMatch[2]) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    // HTTPS format: https://github.com/owner/repo.git
    const httpsMatch = url.match(/https?:\/\/[^/]+\/([^/]+)\/([^/.]+)(?:\.git)?$/);
    if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    return null;
  } catch {
    return null;
  }
}

export function registerStartCodeReviewSessionTool(
  server: McpServer,
  deps: StartCodeReviewSessionToolDeps
): void {
  server.registerTool(
    "start_code_review_session",
    {
      title: "Start Code Review Session",
      description:
        "Initiate a local code review session. Runs git diff on the specified repository, " +
        "creates a code review session, and returns the diff content along with enabled agents. " +
        "Supports staged, unstaged, or branch diff modes.",
      inputSchema: StartCodeReviewSessionInputSchema,
    },
    async (args) => {
      try {
        const input = StartCodeReviewSessionInputSchema.parse(args);

        // Build git diff command args based on diffMode
        const gitArgs: string[] = ["diff"];
        switch (input.diffMode) {
          case "staged":
            gitArgs.push("--cached");
            break;
          case "unstaged":
            // plain `git diff` — no extra args
            break;
          case "branch":
            gitArgs.push(`${input.branchName}...HEAD`);
            break;
          default: {
            const _exhaustive: never = input.diffMode;
            return {
              content: [{ type: "text" as const, text: `Unknown diffMode: ${_exhaustive}` }],
              isError: true,
            };
          }
        }

        // Run git diff
        const diffResult = spawnSync("git", gitArgs, {
          cwd: input.repoPath,
          timeout: DIFF_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        });

        // Handle timeout
        if (diffResult.signal === "SIGTERM") {
          return {
            content: [{ type: "text" as const, text: "git diff timed out after 30 seconds. The diff may be too large." }],
            isError: true,
          };
        }

        // Handle git errors
        if (diffResult.status !== 0) {
          deps.logger.error(
            { stderr: diffResult.stderr?.toString(), exitCode: diffResult.status },
            "git diff failed"
          );
          return {
            content: [{ type: "text" as const, text: "git diff failed. Ensure the branch exists and the repository is valid." }],
            isError: true,
          };
        }

        const diffContent = diffResult.stdout?.toString() ?? "";

        // Check for empty diff
        if (diffContent.trim().length === 0) {
          return {
            content: [{ type: "text" as const, text: "No changes found for the specified diff mode. Nothing to review." }],
            isError: true,
          };
        }

        // Check diff size limit
        const diffSizeBytes = Buffer.byteLength(diffContent, "utf-8");
        if (diffSizeBytes > DIFF_SIZE_LIMIT) {
          const sizeKb = Math.round(diffSizeBytes / 1024);
          return {
            content: [{ type: "text" as const, text: `Diff is too large (${sizeKb} KB). Split your changes into smaller commits or review specific files.` }],
            isError: true,
          };
        }

        // Parse diff stats
        const stats = parseDiffStats(diffContent);

        // Extract owner/repo from git remote
        const remoteInfo = extractOwnerRepo(input.repoPath);
        const repoName = basename(input.repoPath);
        const repoOwner = remoteInfo?.owner ?? null;

        // Look up config using resolved identity
        const configOwner = remoteInfo?.owner ?? "";
        const configRepo = remoteInfo?.repo ?? repoName;

        let configs = await deps.repoReviewConfigsRepo.findByOwnerRepo(configOwner, configRepo);

        // Auto-create defaults if no rows found
        if (configs.length === 0) {
          configs = await deps.repoReviewConfigsRepo.createDefaults(configOwner, configRepo);
        }

        // Filter to enabled
        const enabledConfigs = configs.filter((c) => c.enabled === 1);

        if (enabledConfigs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No agents are enabled for this repository. Use set_repo_review_config to enable at least one.",
              },
            ],
            isError: true,
          };
        }

        // Create code review session
        let session;
        try {
          session = await deps.codeReviewSessionsRepo.create({
            repoPath: input.repoPath,
            repoName,
            repoOwner,
            diffMode: input.diffMode,
            branchName: input.branchName ?? null,
            diffContent,
            filesChanged: stats.filesChanged,
            additions: stats.additions,
            deletions: stats.deletions,
          });
        } catch (dbErr) {
          deps.logger.error({ error: dbErr }, "Failed to create code review session");
          return {
            content: [{ type: "text" as const, text: "Database error. Please try again." }],
            isError: true,
          };
        }

        const result = {
          codeReviewSessionId: session.id,
          repoPath: session.repoPath,
          repoName: session.repoName,
          repoOwner: session.repoOwner,
          diffMode: session.diffMode,
          branchName: session.branchName,
          status: session.status,
          filesChanged: stats.filesChanged,
          additions: stats.additions,
          deletions: stats.deletions,
          diffContent,
          enabledAgents: enabledConfigs.map((c) => ({
            aiTool: c.aiTool,
            agentId: c.agentId,
            suggestedGoal: `Review the local code changes in ${repoName} as ${c.agentId}. The diff content is provided in the session. When complete, store your findings using store_agent_review_draft with codeReviewSessionId=${session.id}, agentId=${c.agentId}, aiTool=${c.aiTool}.`,
          })),
          instructions: `Session ${session.id} created for ${repoName} (${stats.filesChanged} files, +${stats.additions}/-${stats.deletions}). Call agent_start_run for each entry in enabledAgents. Pass the diffContent from this response to each agent as context. When all drafts are stored, run agent_start_run with agentId=review-synthesiser and goal: "Synthesise code review session ${session.id} for ${repoName}".`,
        };

        deps.logger.info(
          {
            codeReviewSessionId: session.id,
            repoPath: input.repoPath,
            repoName,
            diffMode: input.diffMode,
            filesChanged: stats.filesChanged,
            enabledAgentCount: enabledConfigs.length,
          },
          "Code review session started"
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );
}
