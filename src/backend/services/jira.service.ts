import type { Logger } from "pino";
import {
  type Result,
  err,
  ok,
  integrationError,
  validationError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";
import { normalizeJiraRichText } from "./jira-rich-content.service.js";
import { applyJiraCommentMentions } from "./jira-comment-mentions.service.js";
import type {
  JiraAdfDocument,
  JiraMentionInput,
  JiraResolvedUser,
} from "@shared/schemas/jira.schema.js";

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

export type JiraUserResolution = "exact" | "partial";

export type JiraUserSearchResponse = {
  matches: JiraResolvedUser[];
  resolution: "exact" | "partial" | "ambiguous" | "not_found";
};

export type JiraAssignIssueResponse = {
  success: true;
  issueKey: string;
  assignee: JiraResolvedUser | null;
  resolutionMode: JiraUserResolution | "explicit_unassign";
};

export type JiraChangeStatusResponse = {
  success: true;
  issueKey: string;
  transitionId: string;
  transitionName: string;
  toStatusName: string;
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
  mentions?: JiraMentionInput[];
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

export type JiraFindUsersParams = {
  accountId?: string | undefined;
  query?: string | undefined;
  displayName?: string | undefined;
  emailAddress?: string | undefined;
  maxResults?: number | undefined;
};

export type JiraAssignIssueParams = {
  issueKey: string;
  assigneeAccountId?: string | undefined;
  assigneeQuery?: string | undefined;
  assigneeDisplayName?: string | undefined;
  assigneeEmailAddress?: string | undefined;
  unassign?: boolean | undefined;
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

  findUsers(
    params: JiraFindUsersParams
  ): Promise<Result<JiraUserSearchResponse, DomainError>>;

  updateIssueDescription(
    issueKey: string,
    params: Pick<JiraUpdateIssueParams, "description" | "descriptionMarkdown" | "descriptionAdf">
  ): Promise<Result<JiraUpdateIssueResponse, DomainError>>;

  updateIssue(
    params: JiraUpdateIssueParams
  ): Promise<Result<JiraUpdateIssueResponse, DomainError>>;

  assignIssue(
    params: JiraAssignIssueParams
  ): Promise<Result<JiraAssignIssueResponse, DomainError>>;

  changeIssueStatus(
    issueKey: string,
    targetStatusName: string
  ): Promise<Result<JiraChangeStatusResponse, DomainError>>;
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

  function normalizeUserLookupTarget(
    params: JiraFindUsersParams
  ): Result<{
    lookupField: "accountId" | "query" | "displayName" | "emailAddress";
    lookupValue: string;
  }, DomainError> {
    if (params.accountId !== undefined) {
      return ok({ lookupField: "accountId", lookupValue: params.accountId });
    }
    if (params.query !== undefined) {
      return ok({ lookupField: "query", lookupValue: params.query });
    }
    if (params.displayName !== undefined) {
      return ok({ lookupField: "displayName", lookupValue: params.displayName });
    }
    if (params.emailAddress !== undefined) {
      return ok({ lookupField: "emailAddress", lookupValue: params.emailAddress });
    }

    return err(
      validationError("Provide one Jira user identifier: accountId, query, displayName, or emailAddress")
    );
  }

  function classifyUserMatches(
    users: JiraResolvedUser[],
    lookupField: "query" | "displayName" | "emailAddress",
    lookupValue: string
  ): JiraUserSearchResponse {
    const normalizedLookupValue = lookupValue.trim().toLocaleLowerCase();
    const matches = users.filter((user) => {
      const displayName = user.displayName.trim().toLocaleLowerCase();
      const emailAddress = user.emailAddress?.trim().toLocaleLowerCase() ?? "";

      if (lookupField === "displayName") {
        return displayName.includes(normalizedLookupValue);
      }

      if (lookupField === "emailAddress") {
        return emailAddress.includes(normalizedLookupValue);
      }

      return (
        displayName.includes(normalizedLookupValue)
        || emailAddress.includes(normalizedLookupValue)
      );
    });

    if (matches.length === 0) {
      return {
        matches: [],
        resolution: "not_found",
      };
    }

    const exactMatches = matches.filter((user) => {
      const displayName = user.displayName.trim().toLocaleLowerCase();
      const emailAddress = user.emailAddress?.trim().toLocaleLowerCase() ?? "";

      if (lookupField === "displayName") {
        return displayName === normalizedLookupValue;
      }

      if (lookupField === "emailAddress") {
        return emailAddress === normalizedLookupValue;
      }

      return displayName === normalizedLookupValue || emailAddress === normalizedLookupValue;
    });

    if (exactMatches.length === 1) {
      return {
        matches: exactMatches,
        resolution: "exact",
      };
    }

    if (exactMatches.length > 1 || matches.length > 1) {
      return {
        matches: exactMatches.length > 0 ? exactMatches : matches,
        resolution: "ambiguous",
      };
    }

    return {
      matches,
      resolution: "partial",
    };
  }

  async function fetchUsers(
    siteUrl: string,
    auth: string,
    params: JiraFindUsersParams
  ): Promise<Result<JiraUserSearchResponse, DomainError>> {
    const lookupResult = normalizeUserLookupTarget(params);
    if (lookupResult._tag === "Err") {
      return lookupResult;
    }

    const { lookupField, lookupValue } = lookupResult.value;

    if (lookupField === "accountId") {
      const searchParams = new URLSearchParams({ accountId: lookupValue });
      const userResult = await jiraFetch<JiraResolvedUser>(
        siteUrl,
        auth,
        `/user?${searchParams.toString()}`,
        { method: "GET" }
      );

      if (userResult._tag === "Err") {
        if (userResult.error._tag === "IntegrationError" && userResult.error.statusCode === 404) {
          return ok({
            matches: [],
            resolution: "not_found",
          });
        }
        return userResult;
      }

      return ok({
        matches: [userResult.value],
        resolution: "exact",
      });
    }

    const searchParams = new URLSearchParams({
      query: lookupValue,
      maxResults: String(params.maxResults ?? 10),
    });

    const usersResult = await jiraFetch<JiraResolvedUser[]>(
      siteUrl,
      auth,
      `/user/search?${searchParams.toString()}`,
      { method: "GET" }
    );

    if (usersResult._tag === "Err") {
      return usersResult;
    }

    return ok(classifyUserMatches(usersResult.value, lookupField, lookupValue));
  }

  async function resolveSingleUser(
    siteUrl: string,
    auth: string,
    params: JiraFindUsersParams
  ): Promise<Result<{ user: JiraResolvedUser; resolutionMode: JiraUserResolution }, DomainError>> {
    const searchResult = await fetchUsers(siteUrl, auth, params);
    if (searchResult._tag === "Err") {
      return searchResult;
    }

    if (searchResult.value.resolution === "not_found") {
      return err(validationError("No Jira user matched the provided identifier"));
    }

    if (searchResult.value.resolution === "ambiguous") {
      const labels = searchResult.value.matches
        .map((user) => `${user.displayName} (${user.accountId})`)
        .join(", ");
      return err(
        validationError(
          labels.length > 0
            ? `Multiple Jira users matched the provided identifier: ${labels}`
            : "Multiple Jira users matched the provided identifier"
        )
      );
    }

    const [user] = searchResult.value.matches;
    if (!user) {
      return err(validationError("No Jira user matched the provided identifier"));
    }

    return ok({
      user,
      resolutionMode: searchResult.value.resolution,
    });
  }

  async function resolveMentionUsers(
    siteUrl: string,
    auth: string,
    mentions: JiraMentionInput[]
  ): Promise<Result<Array<JiraMentionInput & { user: JiraResolvedUser }>, DomainError>> {
    const resolvedMentions: Array<JiraMentionInput & { user: JiraResolvedUser }> = [];

    for (const mention of mentions) {
      const resolvedMention = await resolveSingleUser(siteUrl, auth, buildUserLookupParams({
        ...(mention.accountId !== undefined ? { accountId: mention.accountId } : {}),
        ...(mention.query !== undefined ? { query: mention.query } : {}),
        ...(mention.displayName !== undefined ? { displayName: mention.displayName } : {}),
        ...(mention.emailAddress !== undefined ? { emailAddress: mention.emailAddress } : {}),
        maxResults: 10,
      }));

      if (resolvedMention._tag === "Err") {
        return resolvedMention;
      }

      resolvedMentions.push({
        ...mention,
        user: resolvedMention.value.user,
      });
    }

    return ok(resolvedMentions);
  }

  function normalizeStatusName(value: string): string {
    return value.trim().toLocaleLowerCase();
  }

  function buildUserLookupParams(params: JiraFindUsersParams): JiraFindUsersParams {
    return {
      ...(params.accountId !== undefined ? { accountId: params.accountId } : {}),
      ...(params.query !== undefined ? { query: params.query } : {}),
      ...(params.displayName !== undefined ? { displayName: params.displayName } : {}),
      ...(params.emailAddress !== undefined ? { emailAddress: params.emailAddress } : {}),
      ...(params.maxResults !== undefined ? { maxResults: params.maxResults } : {}),
    };
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

    async findUsers(
      params: JiraFindUsersParams
    ): Promise<Result<JiraUserSearchResponse, DomainError>> {
      try {
        const connResult = await resolveConnection();
        if (connResult._tag === "Err") return connResult;
        const { siteUrl, auth } = connResult.value;

        logger.debug({ params }, "Finding Jira users");
        return await fetchUsers(siteUrl, auth, params);
      } catch (error) {
        logger.error({ error, params }, "Failed to find Jira users");
        return err(
          integrationError("jira", "Failed to find users: unexpected error")
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

        let commentBody = bodyResult.value.adf;

        if (params.mentions !== undefined && params.mentions.length > 0) {
          const resolvedMentions = await resolveMentionUsers(siteUrl, auth, params.mentions);
          if (resolvedMentions._tag === "Err") {
            return resolvedMentions;
          }

          const mentionResult = applyJiraCommentMentions(commentBody, resolvedMentions.value);
          if (mentionResult._tag === "Err") {
            return mentionResult;
          }

          commentBody = mentionResult.value;
        }

        return await jiraFetch<JiraAddCommentResponse>(
          siteUrl,
          auth,
          `/issue/${encodeURIComponent(params.issueKey)}/comment`,
          {
            method: "POST",
            body: JSON.stringify({ body: commentBody }),
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

    async assignIssue(
      params: JiraAssignIssueParams
    ): Promise<Result<JiraAssignIssueResponse, DomainError>> {
      try {
        const connResult = await resolveConnection();
        if (connResult._tag === "Err") return connResult;
        const { siteUrl, auth } = connResult.value;

        if (params.unassign) {
          const result = await this.updateIssue({
            issueKey: params.issueKey,
            assigneeAccountId: null,
          });

          if (result._tag === "Err") {
            return result;
          }

          return ok({
            success: true,
            issueKey: params.issueKey,
            assignee: null,
            resolutionMode: "explicit_unassign",
          });
        }

        const resolvedAssignee = await resolveSingleUser(siteUrl, auth, buildUserLookupParams({
          ...(params.assigneeAccountId !== undefined ? { accountId: params.assigneeAccountId } : {}),
          ...(params.assigneeQuery !== undefined ? { query: params.assigneeQuery } : {}),
          ...(params.assigneeDisplayName !== undefined ? { displayName: params.assigneeDisplayName } : {}),
          ...(params.assigneeEmailAddress !== undefined ? { emailAddress: params.assigneeEmailAddress } : {}),
          maxResults: 10,
        }));

        if (resolvedAssignee._tag === "Err") {
          return resolvedAssignee;
        }

        const updateResult = await this.updateIssue({
          issueKey: params.issueKey,
          assigneeAccountId: resolvedAssignee.value.user.accountId,
        });

        if (updateResult._tag === "Err") {
          return updateResult;
        }

        return ok({
          success: true,
          issueKey: params.issueKey,
          assignee: resolvedAssignee.value.user,
          resolutionMode: resolvedAssignee.value.resolutionMode,
        });
      } catch (error) {
        logger.error({ error, issueKey: params.issueKey }, "Failed to assign Jira issue");
        return err(
          integrationError("jira", "Failed to assign issue: unexpected error")
        );
      }
    },

    async changeIssueStatus(
      issueKey: string,
      targetStatusName: string
    ): Promise<Result<JiraChangeStatusResponse, DomainError>> {
      try {
        const transitionsResult = await this.getAvailableTransitions(issueKey);
        if (transitionsResult._tag === "Err") {
          return transitionsResult;
        }

        const normalizedTargetStatus = normalizeStatusName(targetStatusName);
        const matchingTransitions = transitionsResult.value.filter((transition) =>
          normalizeStatusName(transition.to.name) === normalizedTargetStatus
          || normalizeStatusName(transition.name) === normalizedTargetStatus
        );

        if (matchingTransitions.length === 0) {
          const availableStatuses = transitionsResult.value.map((transition) => transition.to.name);
          return err(
            validationError(
              `Requested status is not reachable. Available statuses: ${availableStatuses.join(", ")}`
            )
          );
        }

        if (matchingTransitions.length > 1) {
          const transitionNames = matchingTransitions.map((transition) => transition.name);
          return err(
            validationError(
              `Multiple Jira transitions match the requested status: ${transitionNames.join(", ")}`
            )
          );
        }

        const [selectedTransition] = matchingTransitions;
        if (!selectedTransition) {
          return err(validationError("Requested status is not reachable"));
        }

        const transitionResult = await this.transitionIssue(issueKey, selectedTransition.id);
        if (transitionResult._tag === "Err") {
          return transitionResult;
        }

        return ok({
          success: true,
          issueKey,
          transitionId: selectedTransition.id,
          transitionName: selectedTransition.name,
          toStatusName: selectedTransition.to.name,
        });
      } catch (error) {
        logger.error({ error, issueKey, targetStatusName }, "Failed to change Jira issue status");
        return err(
          integrationError("jira", "Failed to change issue status: unexpected error")
        );
      }
    },
  };
}
