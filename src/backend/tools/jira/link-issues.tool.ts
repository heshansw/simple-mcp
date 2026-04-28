import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";
import type { JiraLinkIssuesParams } from "../../services/jira.service.js";
import type { ToolLogger } from "./tool-shared.js";

const COMMON_LINK_TYPES = [
  "Relates",
  "Blocks",
  "Cloners",
  "Duplicate",
  "Problem/Incident",
] as const;

const LinkIssuesInputObjectSchema = z.object({
  inwardIssueKey: z.string().min(1).describe(
    "The issue key for the inward side of the link (e.g. 'PROJ-100'). For 'Blocks', this is the issue that is blocked."
  ),
  outwardIssueKey: z.string().min(1).describe(
    "The issue key for the outward side of the link (e.g. 'PROJ-200'). For 'Blocks', this is the issue that blocks."
  ),
  linkType: z.string().min(1).default("Relates").describe(
    `The name of the link type. Common types: ${COMMON_LINK_TYPES.join(", ")}. Use the exact name as configured in your Jira instance.`
  ),
});

export const LinkIssuesInputSchema = LinkIssuesInputObjectSchema;

export type LinkIssuesInput = z.infer<typeof LinkIssuesInputSchema>;

export type LinkIssuesToolDeps = {
  jiraService: {
    linkIssues(params: JiraLinkIssuesParams): Promise<Result<unknown, DomainError>>;
  };
  logger: ToolLogger;
};

export function registerLinkIssuesTool(
  server: McpServer,
  deps: LinkIssuesToolDeps
): void {
  server.tool(
    "jira_link_issues",
    "Create a link between two Jira issues (e.g. 'relates to', 'blocks', 'duplicates').",
    LinkIssuesInputObjectSchema.shape,
    async (args: unknown) => {
      try {
        const input = LinkIssuesInputSchema.parse(args);
        deps.logger.info("Linking Jira issues", {
          inward: input.inwardIssueKey,
          outward: input.outwardIssueKey,
          type: input.linkType,
        });

        const result = await deps.jiraService.linkIssues(input);

        if (isErr(result)) {
          const errorMsg = `Failed to link Jira issues: ${"message" in result.error ? result.error.message : String(result.error)}`;
          deps.logger.error(errorMsg);
          return {
            content: [{ type: "text" as const, text: errorMsg }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }],
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error linking Jira issues: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
