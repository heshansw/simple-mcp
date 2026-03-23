import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubService } from "../../services/github.service.js";
import { isErr, domainErrorMessage } from "@shared/result.js";

export const ListPrsInputSchema = z.object({
  owner: z.string().min(1, "Owner is required"),
  repo: z.string().min(1, "Repository name is required"),
  state: z
    .enum(["open", "closed", "all"])
    .default("open")
    .describe("Filter PRs by state"),
});

export type ListPrsInput = z.infer<typeof ListPrsInputSchema>;

export type ListPrsToolDeps = {
  githubService: GitHubService;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerListPrsTool(
  server: McpServer,
  deps: ListPrsToolDeps
): void {
  server.tool(
    "github_list_prs",
    "List pull requests from a GitHub repository",
    ListPrsInputSchema.shape,
    async (args) => {
      try {
        const input = ListPrsInputSchema.parse(args);

        const result = await deps.githubService.listPullRequests({
          owner: input.owner,
          repo: input.repo,
          state: input.state,
        });

        if (isErr(result)) {
          return {
            content: [{ type: "text" as const, text: `Failed to list PRs: ${domainErrorMessage(result.error)}` }],
            isError: true,
          };
        }

        const prs = result.value;
        const summary = prs.map((pr) => ({
          number: pr.number,
          title: pr.title,
          author: pr.user.login,
          state: pr.state,
          draft: pr.draft,
          url: pr.html_url,
          created: pr.created_at,
          head: pr.head.ref,
          base: pr.base.ref,
        }));

        return {
          content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error listing PRs: ${errorMsg}` }],
          isError: true,
        };
      }
    }
  );
}
