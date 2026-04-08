import {
  JiraAdfDocumentSchema,
  type JiraAdfDocument,
} from "@shared/schemas/jira.schema.js";
import {
  err,
  ok,
  validationError,
  type DomainError,
  type Result,
} from "@shared/result.js";
import { markdownToAdf } from "./markdown-to-adf.js";

export type JiraRichTextInput = {
  readonly markdown?: string | undefined;
  readonly adf?: unknown;
  readonly legacyMarkdown?: string | undefined;
};

export function normalizeJiraRichText(
  input: JiraRichTextInput
): Result<JiraAdfDocument, DomainError> {
  const hasMarkdown = input.markdown !== undefined;
  const hasAdf = input.adf !== undefined;
  const hasLegacyMarkdown = input.legacyMarkdown !== undefined;
  const providedCount = [hasMarkdown, hasAdf, hasLegacyMarkdown].filter(Boolean).length;

  if (providedCount === 0) {
    return err(validationError("Provide markdown or ADF content"));
  }

  if (providedCount > 1) {
    return err(
      validationError(
        "Provide exactly one rich content format: markdown, legacy markdown, or ADF"
      )
    );
  }

  if (hasAdf) {
    const parsed = JiraAdfDocumentSchema.safeParse(input.adf);
    if (!parsed.success) {
      return err(validationError("Invalid Jira ADF document"));
    }
    return ok(parsed.data);
  }

  const markdown = input.markdown ?? input.legacyMarkdown;
  if (!markdown || markdown.trim().length === 0) {
    return err(validationError("Markdown content cannot be empty"));
  }

  return ok(markdownToAdf(markdown));
}
