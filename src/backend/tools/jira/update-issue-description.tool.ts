import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";
import { JiraAdfDocumentSchema } from "@shared/schemas/jira.schema.js";

const UpdateIssueDescriptionInputObjectSchema = z.object({
  issueKey: z.string().min(1, "Issue key is required"),
  description: z.string().min(1).optional().describe(
    "Legacy markdown alias for the new Jira issue description."
  ),
  descriptionMarkdown: z.string().min(1).optional().describe(
    "Issue description in markdown format. Converted to Jira ADF."
  ),
  descriptionAdf: JiraAdfDocumentSchema.optional().describe(
    "Raw Atlassian Document Format (ADF) document for exact Jira issue description rendering."
  ),
});

export const UpdateIssueDescriptionInputSchema = UpdateIssueDescriptionInputObjectSchema.superRefine((value, ctx) => {
  const providedCount = [
    value.description,
    value.descriptionMarkdown,
    value.descriptionAdf,
  ].filter((item) => item !== undefined).length;

  if (providedCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide exactly one of description, descriptionMarkdown, or descriptionAdf",
      path: ["descriptionMarkdown"],
    });
  }
});

export type UpdateIssueDescriptionInput = z.infer<typeof UpdateIssueDescriptionInputSchema>;

export type UpdateIssueDescriptionToolDeps = {
  jiraService: {
    updateIssueDescription(
      issueKey: string,
      params: Omit<UpdateIssueDescriptionInput, "issueKey">
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

export function registerUpdateIssueDescriptionTool(
  server: McpServer,
  deps: UpdateIssueDescriptionToolDeps
): void {
  server.tool(
    "jira_update_issue_description",
    "Update the description of an existing Jira issue using markdown or raw ADF.",
    UpdateIssueDescriptionInputObjectSchema.shape,
    async (args: unknown) => {
      try {
        const input = UpdateIssueDescriptionInputSchema.parse(args);
        deps.logger.info("Updating Jira issue description", {
          issueKey: input.issueKey,
        });

        const result = await deps.jiraService.updateIssueDescription(
          input.issueKey,
          {
            description: input.description,
            descriptionMarkdown: input.descriptionMarkdown,
            descriptionAdf: input.descriptionAdf,
          }
        );

        if (isErr(result)) {
          const errorMsg = `Failed to update Jira issue description: ${"message" in result.error ? result.error.message : String(result.error)}`;
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
              text: `Error updating Jira issue description: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
