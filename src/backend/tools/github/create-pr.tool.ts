import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubService } from "../../services/github.service.js";
import { isErr, domainErrorMessage } from "@shared/result.js";

export const CreatePrInputSchema = z.object({
  owner: z.string().min(1).describe("Repository owner (e.g. 'octocat')"),
  repo: z.string().min(1).describe("Repository name (e.g. 'hello-world')"),
  title: z.string().min(1).describe("Pull request title"),
  head: z
    .string()
    .min(1)
    .describe("The branch containing your changes (e.g. 'feat/my-feature')"),
  base: z
    .string()
    .min(1)
    .describe("The branch you want to merge into (e.g. 'main')"),
  body: z
    .string()
    .optional()
    .describe("Pull request description/body in markdown"),
  draft: z
    .boolean()
    .optional()
    .describe("Create as a draft pull request (default: false)"),
});

export type CreatePrInput = z.infer<typeof CreatePrInputSchema>;

export type CreatePrToolDeps = {
  githubService: GitHubService;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerCreatePrTool(
  server: McpServer,
  deps: CreatePrToolDeps
): void {
  server.registerTool(
    "github_create_pr",
    {
      title: "Create Pull Request",
      description:
        "Create a new pull request on a GitHub repository. The head branch must " +
        "already be pushed to the remote. Returns the PR number, URL, and metadata.",
      inputSchema: CreatePrInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const input = CreatePrInputSchema.parse(args);

        const result = await deps.githubService.createPullRequest({
          owner: input.owner,
          repo: input.repo,
          title: input.title,
          head: input.head,
          base: input.base,
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.draft !== undefined ? { draft: input.draft } : {}),
        });

        if (isErr(result)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to create PR: ${domainErrorMessage(result.error)}`,
              },
            ],
            isError: true,
          };
        }

        const pr = result.value;

        deps.logger.info(
          {
            owner: input.owner,
            repo: input.repo,
            prNumber: pr.number,
            url: pr.html_url,
          },
          "PR created via MCP tool"
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `Pull request created successfully!`,
                `  PR #${pr.number}: ${pr.title}`,
                `  State: ${pr.state}`,
                `  Draft: ${pr.draft}`,
                `  Head: ${pr.head.ref} -> Base: ${pr.base.ref}`,
                `  URL: ${pr.html_url}`,
              ].join("\n"),
            },
          ],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating PR: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
