import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GitHubService } from "../../services/github.service.js";
import { isErr, domainErrorMessage } from "@shared/result.js";

export const GetMyPrsInputSchema = z.object({
  filter: z
    .enum(["assigned", "review-requested", "created", "all"])
    .default("all")
    .describe(
      "Filter PRs: 'assigned' for PRs assigned to you, 'review-requested' for PRs " +
      "needing your review, 'created' for PRs you authored, 'all' for everything."
    ),
});

export type GetMyPrsInput = z.infer<typeof GetMyPrsInputSchema>;

export type GetMyPrsToolDeps = {
  githubService: GitHubService;
  logger: {
    info(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
};

export function registerGetMyPrsTool(
  server: McpServer,
  deps: GetMyPrsToolDeps
): void {
  server.registerTool(
    "github_get_my_prs",
    {
      title: "My Pull Requests",
      description:
        "List open pull requests relevant to the authenticated GitHub user. " +
        "Shows PRs assigned to you, PRs where your review is requested, " +
        "or PRs you created. Use with github_get_pr_diff to review specific PRs.",
      inputSchema: GetMyPrsInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const input = GetMyPrsInputSchema.parse(args);

        // Get user info first
        const userResult = await deps.githubService.getAuthenticatedUser();
        if (isErr(userResult)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to get GitHub user: ${domainErrorMessage(userResult.error)}. Ensure a GitHub access token is configured in Connections.`,
              },
            ],
            isError: true,
          };
        }

        const user = userResult.value;
        const sections: string[] = [`# PRs for ${user.login}\n`];

        const shouldFetch = (type: string) =>
          input.filter === "all" || input.filter === type;

        if (shouldFetch("review-requested")) {
          const result = await deps.githubService.getMyReviewRequests();
          if (!isErr(result) && result.value.length > 0) {
            sections.push(`## Review Requested (${result.value.length})\n`);
            for (const pr of result.value) {
              sections.push(
                `- **#${pr.number}** ${pr.title} — by ${pr.user.login} (${pr.html_url})`
              );
            }
            sections.push("");
          } else if (!isErr(result)) {
            sections.push("## Review Requested\n\nNone.\n");
          }
        }

        if (shouldFetch("assigned")) {
          const result = await deps.githubService.getMyAssignedPRs();
          if (!isErr(result) && result.value.length > 0) {
            sections.push(`## Assigned to Me (${result.value.length})\n`);
            for (const pr of result.value) {
              sections.push(
                `- **#${pr.number}** ${pr.title} — by ${pr.user.login} (${pr.html_url})`
              );
            }
            sections.push("");
          } else if (!isErr(result)) {
            sections.push("## Assigned to Me\n\nNone.\n");
          }
        }

        if (shouldFetch("created")) {
          const result = await deps.githubService.getMyCreatedPRs();
          if (!isErr(result) && result.value.length > 0) {
            sections.push(`## Created by Me (${result.value.length})\n`);
            for (const pr of result.value) {
              sections.push(
                `- **#${pr.number}** ${pr.title} — ${pr.state} (${pr.html_url})`
              );
            }
            sections.push("");
          } else if (!isErr(result)) {
            sections.push("## Created by Me\n\nNone.\n");
          }
        }

        return {
          content: [{ type: "text" as const, text: sections.join("\n") }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching your PRs: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
