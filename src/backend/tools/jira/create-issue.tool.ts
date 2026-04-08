import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr } from "@shared/result.js";
import type { Result, DomainError } from "@shared/result.js";
import { JiraAdfDocumentSchema } from "@shared/schemas/jira.schema.js";

const CreateIssueInputObjectSchema = z.object({
  projectKey: z.string().min(1, "Project key is required"),
  summary: z.string().min(1, "Summary is required"),
  issueType: z.string().default("Task"),
  description: z.string().optional().describe(
    "Issue description in markdown format. Supports: headings (#), bullet lists (- or *), ordered lists (1.), code blocks (```lang), blockquotes (>), inline **bold**, *italic*, ~~strikethrough~~, `code`, [links](url). Automatically converted to Jira's ADF format."
  ),
  descriptionMarkdown: z.string().min(1).optional().describe(
    "Issue description in markdown format. Supports Jira-friendly rich content and is converted to ADF."
  ),
  descriptionAdf: JiraAdfDocumentSchema.optional().describe(
    "Raw Atlassian Document Format (ADF) document for the issue description. Use this for exact Jira rendering, including tables and task lists."
  ),
});

export const CreateIssueInputSchema = CreateIssueInputObjectSchema.superRefine((value, ctx) => {
  const providedCount = [
    value.description,
    value.descriptionMarkdown,
    value.descriptionAdf,
  ].filter((item) => item !== undefined).length;

  if (providedCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide only one of description, descriptionMarkdown, or descriptionAdf",
      path: ["descriptionMarkdown"],
    });
  }
});

export type CreateIssueInput = z.infer<typeof CreateIssueInputSchema>;

export type CreateIssueToolDeps = {
  jiraService: {
    createIssue(params: CreateIssueInput): Promise<Result<unknown, DomainError>>;
  };
  connectionManager: {
    getConnection(integrationName: string): unknown;
  };
  logger: {
    info(msg: string, meta?: unknown): void;
    error(msg: string, meta?: unknown): void;
  };
};

export function registerCreateIssueTool(
  server: McpServer,
  deps: CreateIssueToolDeps
): void {
  server.tool(
    "jira_create_issue",
    "Create a new Jira issue",
    CreateIssueInputObjectSchema.shape,
    async (args: unknown) => {
      try {
        const input = CreateIssueInputSchema.parse(args);
        deps.logger.info("Creating Jira issue", { projectKey: input.projectKey });

        const result = await deps.jiraService.createIssue(
          input
        );

        if (isErr(result)) {
          const errorMsg = `Failed to create Jira issue: ${"message" in result.error ? result.error.message : String(result.error)}`;
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
              text: `Error creating Jira issue: ${errorMsg}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
