import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";

export const TransitionIssueInputSchema = z.object({
  issueKey: z.string().min(1, "Issue key is required"),
  transitionId: z.string().min(1, "Transition ID is required"),
});

export type TransitionIssueInput = z.infer<typeof TransitionIssueInputSchema>;

export type TransitionIssueToolDeps = {
  jiraService: {
    transitionIssue(
      issueKey: string,
      transitionId: string
    ): Promise<Result<unknown, DomainError>>;
  };
  connectionManager: {
    getConnection(integrationName: string): unknown;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerTransitionIssueTool(
  server: McpServer,
  deps: TransitionIssueToolDeps
): void {
  server.tool(
    "jira_transition_issue",
    "Transition a Jira issue to a different status",
    TransitionIssueInputSchema.shape,
    async (args) => {
      try {
        const input = TransitionIssueInputSchema.parse(args);
        deps.logger.info("Transitioning Jira issue", {
          issueKey: input.issueKey,
        });

        const result = await deps.jiraService.transitionIssue(
          input.issueKey,
          input.transitionId
        );

        if (isErr(result)) {
          const errorMsg = `Failed to transition Jira issue: ${"message" in result.error ? result.error.message : String(result.error)}`;
          deps.logger.error(errorMsg);
          return {
            content: [{ type: "text" as const, text: errorMsg }],
            isError: true,
          };
        }

        const successText = JSON.stringify(result.value, null, 2);
        return {
          content: [{ type: "text" as const, text: successText }],
        };
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error transitioning Jira issue: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
