import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";
import { JiraAdfDocumentSchema } from "@shared/schemas/jira.schema.js";

const UpdateIssueInputObjectSchema = z.object({
  issueKey: z.string().min(1, "Issue key is required"),
  summary: z.string().min(1).optional(),
  description: z.string().min(1).optional().describe(
    "Legacy markdown alias for issue description."
  ),
  descriptionMarkdown: z.string().min(1).optional().describe(
    "Issue description in markdown format. Converted to Jira ADF."
  ),
  descriptionAdf: JiraAdfDocumentSchema.optional().describe(
    "Raw Atlassian Document Format (ADF) document for exact Jira description rendering."
  ),
  labels: z.array(z.string().min(1)).optional(),
  priority: z.string().min(1).optional(),
  assigneeAccountId: z.string().min(1).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const UpdateIssueInputSchema = UpdateIssueInputObjectSchema.superRefine((value, ctx) => {
  const descriptionCount = [
    value.description,
    value.descriptionMarkdown,
    value.descriptionAdf,
  ].filter((item) => item !== undefined).length;

  if (descriptionCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide only one of description, descriptionMarkdown, or descriptionAdf",
      path: ["descriptionMarkdown"],
    });
  }

  const hasUpdateField = [
    value.summary,
    value.description,
    value.descriptionMarkdown,
    value.descriptionAdf,
    value.labels,
    value.priority,
    value.assigneeAccountId,
    value.dueDate,
  ].some((item) => item !== undefined);

  if (!hasUpdateField) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At least one issue field must be provided",
      path: ["issueKey"],
    });
  }
});

export type UpdateIssueInput = z.infer<typeof UpdateIssueInputSchema>;

export type UpdateIssueToolDeps = {
  jiraService: {
    updateIssue(params: UpdateIssueInput): Promise<Result<unknown, DomainError>>;
  };
  connectionManager: {
    getConnection(integrationName: string): unknown;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerUpdateIssueTool(
  server: McpServer,
  deps: UpdateIssueToolDeps
): void {
  server.tool(
    "jira_update_issue",
    "Update editable Jira issue fields including summary, description, labels, priority, assignee, and due date.",
    UpdateIssueInputObjectSchema.shape,
    async (args: unknown) => {
      try {
        const input = UpdateIssueInputSchema.parse(args);
        deps.logger.info("Updating Jira issue", {
          issueKey: input.issueKey,
        });

        const result = await deps.jiraService.updateIssue(input);

        if (isErr(result)) {
          const errorMsg = `Failed to update Jira issue: ${"message" in result.error ? result.error.message : String(result.error)}`;
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
              text: `Error updating Jira issue: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
