import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubService } from "../../services/github.service.js";
import type { ReviewsRepository } from "../../db/repositories/reviews.repository.js";
import { isErr, domainErrorMessage } from "@shared/result.js";

export const GetPrDiffInputSchema = z.object({
  owner: z.string().min(1).describe("Repository owner (e.g. 'octocat')"),
  repo: z.string().min(1).describe("Repository name (e.g. 'hello-world')"),
  prNumber: z
    .number()
    .int()
    .positive()
    .describe("Pull request number to fetch"),
});

export type GetPrDiffInput = z.infer<typeof GetPrDiffInputSchema>;

export type GetPrDiffToolDeps = {
  githubService: GitHubService;
  reviewsRepo: ReviewsRepository;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerGetPrDiffTool(
  server: McpServer,
  deps: GetPrDiffToolDeps
): void {
  server.registerTool(
    "github_get_pr_diff",
    {
      title: "Get PR Diff",
      description:
        "Fetch a pull request's full details including title, description, author, branch info, " +
        "and the complete diff for every changed file. Use this to review code changes before " +
        "submitting a review with github_submit_review.",
      inputSchema: GetPrDiffInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const input = GetPrDiffInputSchema.parse(args);

        // Fetch PR details and files in parallel
        const [prResult, filesResult] = await Promise.all([
          deps.githubService.getPullRequest(input.owner, input.repo, input.prNumber),
          deps.githubService.getPullRequestFiles(input.owner, input.repo, input.prNumber),
        ]);

        if (isErr(prResult)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to fetch PR: ${domainErrorMessage(prResult.error)}. Check that the owner, repo, and PR number are correct and that your GitHub token has access.`,
              },
            ],
            isError: true,
          };
        }

        if (isErr(filesResult)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to fetch PR files: ${domainErrorMessage(filesResult.error)}. The PR exists but file data couldn't be retrieved.`,
              },
            ],
            isError: true,
          };
        }

        const pr = prResult.value;
        const files = filesResult.value;

        const totalAdditions = files.reduce((s, f) => s + f.additions, 0);
        const totalDeletions = files.reduce((s, f) => s + f.deletions, 0);

        // Build comprehensive diff output for Claude to analyze
        const fileDiffs = files.map((f) => {
          const patch = f.patch ?? "(binary file or too large to display)";
          return [
            `## ${f.filename}`,
            `Status: ${f.status} | +${f.additions} -${f.deletions} (${f.changes} total)`,
            "",
            "```diff",
            patch,
            "```",
          ].join("\n");
        });

        const output = [
          `# Pull Request #${pr.number}: ${pr.title}`,
          "",
          `**Author:** ${pr.user.login}`,
          `**Branch:** ${pr.head.ref} → ${pr.base.ref}`,
          `**State:** ${pr.state}${pr.draft ? " (draft)" : ""}`,
          `**URL:** ${pr.html_url}`,
          `**Created:** ${pr.created_at}`,
          `**Updated:** ${pr.updated_at}`,
          "",
          "## Description",
          "",
          pr.body || "(no description provided)",
          "",
          `## Changed Files (${files.length} files, +${totalAdditions} -${totalDeletions})`,
          "",
          ...fileDiffs,
        ].join("\n");

        // Estimate input tokens (rough: chars / 4)
        const inputTokensEstimate = Math.ceil(output.length / 4);

        // Record an in-progress review in the DB
        try {
          await deps.reviewsRepo.createInProgress({
            owner: input.owner,
            repo: input.repo,
            prNumber: input.prNumber,
            prTitle: pr.title,
            prAuthor: pr.user.login,
            filesChanged: files.length,
            additions: totalAdditions,
            deletions: totalDeletions,
            inputTokensEstimate,
          });
        } catch (dbErr) {
          deps.logger.error({ error: dbErr }, "Failed to persist in-progress review");
        }

        deps.logger.info(
          { owner: input.owner, repo: input.repo, prNumber: input.prNumber, fileCount: files.length },
          "PR diff fetched for review"
        );

        return {
          content: [{ type: "text" as const, text: output }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching PR diff: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
