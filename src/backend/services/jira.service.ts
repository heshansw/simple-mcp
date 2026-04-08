import type { Logger } from "pino";
import {
  type Result,
  err,
  ok,
  integrationError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";
import { normalizeJiraRichText } from "./jira-rich-content.service.js";
import type { JiraAdfDocument } from "@shared/schemas/jira.schema.js";

// ── Jira API response types ────────────────────────────────────────────

export type JiraIssue = {
  id: string;
  key: string;
  self: string;
  fields: {
    summary: string;
    status: { name: string; id: string };
    issuetype: { name: string; id: string };
    priority?: { name: string; id: string } | null;
    assignee?: { displayName: string; accountId: string; emailAddress?: string } | null;
    reporter?: { displayName: string; accountId: string } | null;
    project: { key: string; name: string };
    created: string;
    updated: string;
    description?: unknown;
    labels?: string[];
  };
};

export type JiraSearchResponse = {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
};

export type JiraCreateIssueResponse = {
  id: string;
  key: string;
  self: string;
};

export type JiraTransition = {
  id: string;
  name: string;
  to: { name: string; id: string };
};

export type JiraComment = {
  id: string;
  self: string;
  body: unknown; // ADF document
  author: {
    accountId: string;
    displayName: string;
    emailAddress?: string;
  };
  created: string;
  updated: string;
};

export type JiraCommentsResponse = {
  comments: JiraComment[];
  startAt: number;
  maxResults: number;
  total: number;
};

export type JiraAddCommentResponse = {
  id: string;
  self: string;
};

export type JiraUpdateIssueResponse = {
  success: true;
  issueKey: string;
  updatedFields: string[];
  mode: "markdown" | "adf" | undefined;
};

export type JiraProjectMetadata = {
  projectKey: string;
  projectName: string;
  issueTypes: Array<{ id: string; name: string }>;
};

export type JiraCreateIssueParams = {
  projectKey: string;
  summary: string;
  issueType: string;
  description?: string;
  descriptionMarkdown?: string;
  descriptionAdf?: JiraAdfDocument;
};

export type JiraAddCommentParams = {
  issueKey: string;
  body?: string;
  bodyMarkdown?: string;
  bodyAdf?: JiraAdfDocument;
};

export type JiraUpdateIssueParams = {
  issueKey: string;
  summary?: string;
  description?: string;
  descriptionMarkdown?: string;
  descriptionAdf?: JiraAdfDocument;
  labels?: string[];
  priority?: string;
  assigneeAccountId?: string | null;
  dueDate?: string | null;
};

// ── Credentials shape ──────────────────────────────────────────────────

/** Credentials stored as JSON: `{ email, apiToken }` for Basic auth */
export type JiraCredentials = {
  email: string;
  apiToken: string;
};

// ── Dependencies ───────────────────────────────────────────────────────

export type JiraDependencies = {
  logger: Logger;
  /**
   * Returns the Jira site URL (e.g. "https://acme.atlassian.net") and
   * decrypted credentials from the first connected Jira connection.
   * Returns null when no Jira connection is configured or credentials
   * are missing.
   */
  getConnectionInfo: () => Promise<{ siteUrl: string; credentials: JiraCredentials } | null>;
};

// ── Service interface (matches what the tool files expect) ─────────────

export interface JiraServiceResult {
  searchIssues(
    jql: string,
    maxResults: number
  ): Promise<Result<JiraSearchResponse, DomainError>>;

  createIssue(
    params: JiraCreateIssueParams
  ): Promise<Result<JiraCreateIssueResponse, DomainError>>;

  transitionIssue(
    issueKey: string,
    transitionId: string
  ): Promise<Result<{ status: string }, DomainError>>;

  getAvailableTransitions(
    issueKey: string
  ): Promise<Result<JiraTransition[], DomainError>>;

  getProjectMetadata(
    projectKeys: string[]
  ): Promise<Result<JiraProjectMetadata[], DomainError>>;

  getIssueComments(
    issueKey: string,
    startAt?: number,
    maxResults?: number
  ): Promise<Result<JiraCommentsResponse, DomainError>>;

  addComment(
    params: JiraAddCommentParams
  ): Promise<Result<JiraAddCommentResponse, DomainError>>;

  updateIssueDescription(
    issueKey: string,
    params: Pick<JiraUpdateIssueParams, "description" | "descriptionMarkdown" | "descriptionAdf">
  ): Promise<Result<JiraUpdateIssueResponse, DomainError>>;

  updateIssue(
    params: JiraUpdateIssueParams
  ): Promise<Result<JiraUpdateIssueResponse, DomainError>>;
}

// ── Implementation ─────────────────────────────────────────────────────

export function createJiraService(
  deps: JiraDependencies
): JiraServiceResult {
  const { logger } = deps;

  function normalizeDescription(
    input: Pick<JiraCreateIssueParams, "description" | "descriptionMarkdown" | "descriptionAdf">
  ): Result<{ adf: JiraAdfDocument; mode: "markdown" | "adf" }, DomainError> {
    const normalized = normalizeJiraRichText({
      markdown: input.descriptionMarkdown,
      legacyMarkdown: input.description,
      adf: input.descriptionAdf,
    });

    if (normalized._tag === "Err") {
      return normalized;
    }

    return ok({
      adf: normalized.value,
      mode: input.descriptionAdf !== undefined ? "adf" : "markdown",
    });
  }

  function normalizeComment(
    input: JiraAddCommentParams
  ): Result<{ adf: JiraAdfDocument; mode: "markdown" | "adf" }, DomainError> {
    const normalized = normalizeJiraRichText({
      markdown: input.bodyMarkdown,
      legacyMarkdown: input.body,
      adf: input.bodyAdf,
    });

    if (normalized._tag === "Err") {
      return normalized;
    }

    return ok({
      adf: normalized.value,
      mode: input.bodyAdf !== undefined ? "adf" : "markdown",
    });
  }

  function buildUpdateFields(
    params: JiraUpdateIssueParams
  ): Result<{ fields: Record<string, unknown>; updatedFields: string[]; mode?: "markdown" | "adf" }, DomainError> {
    const fields: Record<string, unknown> = {};
    const updatedFields: string[] = [];
    let mode: "markdown" | "adf" | undefined;

    if (params.summary !== undefined) {
      fields.summary = params.summary;
      updatedFields.push("summary");
    }

    if (
      params.description !== undefined ||
      params.descriptionMarkdown !== undefined ||
      params.descriptionAdf !== undefined
    ) {
      const descriptionResult = normalizeDescription(params);
      if (descriptionResult._tag === "Err") {
        return descriptionResult;
      }

      fields.description = descriptionResult.value.adf;
      updatedFields.push("description");
      mode = descriptionResult.value.mode;
    }

    if (params.labels !== undefined) {
      fields.labels = params.labels;
      updatedFields.push("labels");
    }

    if (params.priority !== undefined) {
      fields.priority = { name: params.priority };
      updatedFields.push("priority");
    }

    if (params.assigneeAccountId !== undefined) {
      fields.assignee = params.assigneeAccountId === null
        ? null
        : { accountId: params.assigneeAccountId };
      updatedFields.push("assignee");
    }

    if (params.dueDate !== undefined) {
      fields.duedate = params.dueDate;
      updatedFields.push("dueDate");
    }

    return ok({ fields, updatedFields, ...(mode !== undefined ? { mode } : {}) });
  }

  /**
   * Build Basic auth header from Jira Cloud credentials.
   * Format: `Basic base64(email:apiToken)`
   */
  function buildAuthHeader(creds: JiraCredentials): string {
    const encoded = Buffer.from(`${creds.email}:${creds.apiToken}`).toString("base64");
    return `Basic ${encoded}`;
  }

  /**
   * Resolve connection info or return an IntegrationError.
   */
  async function resolveConnection(): Promise<
    Result<{ siteUrl: string; auth: string }, DomainError>
  > {
    const info = await deps.getConnectionInfo();
    if (!info) {
      return err(
        integrationError(
          "jira",
          "No connected Jira instance found. Create a Jira connection and store credentials (email + API token as JSON) via the admin panel."
        )
      );
    }
    return ok({
      siteUrl: info.siteUrl.replace(/\/+$/, ""), // strip trailing slashes
      auth: buildAuthHeader(info.credentials),
    });
  }

  /**
   * Generic Jira REST API fetch wrapper with error handling.
   */
  async function jiraFetch<T>(
    siteUrl: string,
    auth: string,
    path: string,
    options: RequestInit = {}
  ): Promise<Result<T, DomainError>> {
    const url = `${siteUrl}/rest/api/3${path}`;

    const headers: Record<string, string> = {
      Authorization: auth,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) ?? {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error(
        { status: response.status, url, body },
        "Jira API request failed"
      );

      let detail = `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(body) as { errorMessages?: string[]; errors?: Record<string, string> };
        const messages = [
          ...(parsed.errorMessages ?? []),
          ...Object.values(parsed.errors ?? {}),
        ].filter(Boolean);
        if (messages.length > 0) {
          detail += `: ${messages.join("; ")}`;
        }
      } catch {
        if (body) detail += `: ${body.slice(0, 200)}`;
      }

      return err(integrationError("jira", detail, response.status));
    }

    // Some Jira endpoints return 204 with no body (e.g. transitions)
    if (response.status === 204 || response.headers.get("content-length") === "0") {
      return ok(undefined as T);
    }

    const data = (await response.json()) as T;
    return ok(data);
  }

  return {
    async searchIssues(
      jql: string,
      maxResults: number
    ): Promise<Result<JiraSearchResponse, DomainError>> {
      try {
        const connResult = await resolveConnection();
        if (connResult._tag === "Err") return connResult;
        const { siteUrl, auth } = connResult.value;

        logger.debug({ jql, maxResults }, "Searching Jira issues");

        return await jiraFetch<JiraSearchResponse>(siteUrl, auth, "/search/jql", {
          method: "POST",
          body: JSON.stringify({
            jql,
            maxResults,
            fields: [
              "summary",
              "status",
              "issuetype",
              "priority",
              "assignee",
              "reporter",
              "project",
              "created",
              "updated",
              "description",
              "labels",
            ],
          }),
        });
      } catch (error) {
        logger.error({ error, jql }, "Failed to search Jira issues");
        return err(
          integrationError("jira", "Failed to search issues: unexpected error")
        );
      }
    },

    async createIssue(
      params: JiraCreateIssueParams
    ): Promise<Result<JiraCreateIssueResponse, DomainError>> {
      try {
        const connResult = await resolveConnection();
        if (connResult._tag === "Err") return connResult;
        const { siteUrl, auth } = connResult.value;

        logger.debug(
          { projectKey: params.projectKey, summary: params.summary, issueType: params.issueType },
          "Creating Jira issue"
        );

        const fields: Record<string, unknown> = {
          project: { key: params.projectKey },
          summary: params.summary,
          issuetype: { name: params.issueType },
        };

        if (
          params.description !== undefined ||
          params.descriptionMarkdown !== undefined ||
          params.descriptionAdf !== undefined
        ) {
          const descriptionResult = normalizeDescription(params);
          if (descriptionResult._tag === "Err") {
            return descriptionResult;
          }
          fields.description = descriptionResult.value.adf;
        }

        return await jiraFetch<JiraCreateIssueResponse>(siteUrl, auth, "/issue", {
          method: "POST",
          body: JSON.stringify({ fields }),
        });
      } catch (error) {
        logger.error(
          { error, projectKey: params.projectKey, summary: params.summary },
          "Failed to create Jira issue"
        );
        return err(
          integrationError("jira", "Failed to create issue: unexpected error")
        );
      }
    },

    async transitionIssue(
      issueKey: string,
      transitionId: string
    ): Promise<Result<{ status: string }, DomainError>> {
      try {
        const connResult = await resolveConnection();
        if (connResult._tag === "Err") return connResult;
        const { siteUrl, auth } = connResult.value;

        logger.debug({ issueKey, transitionId }, "Transitioning Jira issue");

        const result = await jiraFetch<undefined>(
          siteUrl,
          auth,
          `/issue/${encodeURIComponent(issueKey)}/transitions`,
          {
            method: "POST",
            body: JSON.stringify({
              transition: { id: transitionId },
            }),
          }
        );

        if (result._tag === "Err") return result;

        return ok({ status: "transitioned" });
      } catch (error) {
        logger.error({ error, issueKey }, "Failed to transition Jira issue");
        return err(
          integrationError("jira", "Failed to transition issue: unexpected error")
        );
      }
    },

    async getAvailableTransitions(
      issueKey: string
    ): Promise<Result<JiraTransition[], DomainError>> {
      try {
        const connResult = await resolveConnection();
        if (connResult._tag === "Err") return connResult;
        const { siteUrl, auth } = connResult.value;

        logger.debug({ issueKey }, "Fetching available transitions");

        const result = await jiraFetch<{ transitions: JiraTransition[] }>(
          siteUrl,
          auth,
          `/issue/${encodeURIComponent(issueKey)}/transitions`,
          { method: "GET" }
        );

        if (result._tag === "Err") return result;

        return ok(result.value.transitions);
      } catch (error) {
        logger.error({ error, issueKey }, "Failed to get transitions");
        return err(
          integrationError("jira", "Failed to get transitions: unexpected error")
        );
      }
    },

    async getProjectMetadata(
      projectKeys: string[]
    ): Promise<Result<JiraProjectMetadata[], DomainError>> {
      try {
        const connResult = await resolveConnection();
        if (connResult._tag === "Err") return connResult;
        const { siteUrl, auth } = connResult.value;

        logger.debug({ projectKeys }, "Fetching Jira project metadata");

        const results: JiraProjectMetadata[] = [];

        for (const projectKey of projectKeys) {
          const projectResult = await jiraFetch<{
            key: string;
            name: string;
            issueTypes: Array<{ id: string; name: string }>;
          }>(siteUrl, auth, `/project/${encodeURIComponent(projectKey)}`);

          if (projectResult._tag === "Err") {
            logger.warn(
              { projectKey, error: projectResult.error },
              "Failed to fetch metadata for project — skipping"
            );
            continue;
          }

          results.push({
            projectKey: projectResult.value.key,
            projectName: projectResult.value.name,
            issueTypes: projectResult.value.issueTypes.map((t) => ({
              id: t.id,
              name: t.name,
            })),
          });
        }

        return ok(results);
      } catch (error) {
        logger.error({ error }, "Failed to fetch Jira project metadata");
        return err(
          integrationError("jira", "Failed to fetch project metadata: unexpected error")
        );
      }
    },

    async getIssueComments(
      issueKey: string,
      startAt = 0,
      maxResults = 50
    ): Promise<Result<JiraCommentsResponse, DomainError>> {
      try {
        const connResult = await resolveConnection();
        if (connResult._tag === "Err") return connResult;
        const { siteUrl, auth } = connResult.value;

        logger.debug({ issueKey, startAt, maxResults }, "Fetching Jira issue comments");

        const params = new URLSearchParams({
          startAt: String(startAt),
          maxResults: String(maxResults),
          orderBy: "-created",
        });

        return await jiraFetch<JiraCommentsResponse>(
          siteUrl,
          auth,
          `/issue/${encodeURIComponent(issueKey)}/comment?${params.toString()}`,
          { method: "GET" }
        );
      } catch (error) {
        logger.error({ error, issueKey }, "Failed to fetch Jira issue comments");
        return err(
          integrationError("jira", "Failed to fetch comments: unexpected error")
        );
      }
    },

    async addComment(
      params: JiraAddCommentParams
    ): Promise<Result<JiraAddCommentResponse, DomainError>> {
      try {
        const connResult = await resolveConnection();
        if (connResult._tag === "Err") return connResult;
        const { siteUrl, auth } = connResult.value;

        logger.debug({ issueKey: params.issueKey }, "Adding comment to Jira issue");

        const bodyResult = normalizeComment(params);
        if (bodyResult._tag === "Err") {
          return bodyResult;
        }

        return await jiraFetch<JiraAddCommentResponse>(
          siteUrl,
          auth,
          `/issue/${encodeURIComponent(params.issueKey)}/comment`,
          {
            method: "POST",
            body: JSON.stringify({ body: bodyResult.value.adf }),
          }
        );
      } catch (error) {
        logger.error({ error, issueKey: params.issueKey }, "Failed to add comment to Jira issue");
        return err(
          integrationError("jira", "Failed to add comment: unexpected error")
        );
      }
    },

    async updateIssueDescription(
      issueKey: string,
      params: Pick<JiraUpdateIssueParams, "description" | "descriptionMarkdown" | "descriptionAdf">
    ): Promise<Result<JiraUpdateIssueResponse, DomainError>> {
      const result = await this.updateIssue({
        issueKey,
        ...params,
      });

      if (result._tag === "Err") {
        return result;
      }

      return ok({
        success: true,
        issueKey,
        updatedFields: ["description"],
        mode: result.value.mode,
      });
    },

    async updateIssue(
      params: JiraUpdateIssueParams
    ): Promise<Result<JiraUpdateIssueResponse, DomainError>> {
      try {
        const connResult = await resolveConnection();
        if (connResult._tag === "Err") return connResult;
        const { siteUrl, auth } = connResult.value;

        const updateResult = buildUpdateFields(params);
        if (updateResult._tag === "Err") {
          return updateResult;
        }

        logger.debug(
          { issueKey: params.issueKey, updatedFields: updateResult.value.updatedFields },
          "Updating Jira issue"
        );

        const result = await jiraFetch<undefined>(
          siteUrl,
          auth,
          `/issue/${encodeURIComponent(params.issueKey)}`,
          {
            method: "PUT",
            body: JSON.stringify({ fields: updateResult.value.fields }),
          }
        );

        if (result._tag === "Err") {
          return result;
        }

        return ok({
          success: true,
          issueKey: params.issueKey,
          updatedFields: updateResult.value.updatedFields,
          mode: updateResult.value.mode,
        });
      } catch (error) {
        logger.error({ error, issueKey: params.issueKey }, "Failed to update Jira issue");
        return err(
          integrationError("jira", "Failed to update issue: unexpected error")
        );
      }
    },
  };
}
