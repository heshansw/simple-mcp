import type { Logger } from "pino";
import { NodeHtmlMarkdown } from "node-html-markdown";
import {
  type Result,
  err,
  ok,
  integrationError,
  notFoundError,
  validationError,
  authorizationError,
} from "../../shared/result.js";
import type { DomainError } from "../../shared/result.js";
import type {
  ConfluencePage,
  ConfluenceSpace,
  ConfluenceSearchResult,
  AllowedSpaceKeys,
} from "../../shared/schemas/confluence.schema.js";
import type { JiraCredentials } from "./jira.service.js";

// ── Dependencies ─────────────────────────────────────────────────────

export type ConfluenceDependencies = {
  getConnectionInfo: () => Promise<{
    siteUrl: string;
    credentials: JiraCredentials;
  } | null>;
  getAllowedSpaceKeys: () => Promise<AllowedSpaceKeys>;
  logger: Logger;
};

// ── Service interface ────────────────────────────────────────────────

export interface ConfluenceService {
  searchPages(
    cql: string,
    maxResults: number
  ): Promise<Result<{ total: number; results: ConfluenceSearchResult[] }, DomainError>>;
  getPage(pageId: string): Promise<Result<ConfluencePage, DomainError>>;
  listSpaces(
    type: "global" | "personal" | "all",
    maxResults: number
  ): Promise<Result<{ total: number; spaces: ConfluenceSpace[] }, DomainError>>;
}

// ── Constants ────────────────────────────────────────────────────────

const MAX_RESULTS_CAP = 50;
const MAX_BODY_SIZE_BYTES = 500 * 1024; // 500 KB
const REQUEST_TIMEOUT_MS = 10_000;

// ── Factory ──────────────────────────────────────────────────────────

export function createConfluenceService(
  deps: ConfluenceDependencies
): ConfluenceService {
  const { logger, getConnectionInfo, getAllowedSpaceKeys } = deps;
  const nhm = new NodeHtmlMarkdown();

  async function getAuthHeaders(): Promise<
    Result<{ headers: Record<string, string>; siteUrl: string }, DomainError>
  > {
    const info = await getConnectionInfo();
    if (!info) {
      return err(
        authorizationError(
          "Configure and connect a Jira integration first",
          "confluence"
        )
      );
    }
    const { siteUrl, credentials } = info;
    const basic = Buffer.from(
      `${credentials.email}:${credentials.apiToken}`
    ).toString("base64");
    return ok({
      siteUrl,
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
      },
    });
  }

  async function confluenceFetch(
    siteUrl: string,
    path: string,
    headers: Record<string, string>
  ): Promise<Result<unknown, DomainError>> {
    const url = `${siteUrl}/wiki/rest/api/${path}`;
    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 401) {
        return err(
          authorizationError("Confluence authentication failed", "confluence")
        );
      }
      if (response.status === 403) {
        return err(
          authorizationError(
            "Insufficient Confluence permissions — read:confluence-content.all scope required",
            "confluence"
          )
        );
      }
      if (response.status === 404) {
        return err(notFoundError("ConfluencePage", path));
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const seconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
        return err(
          integrationError(
            "confluence",
            `Rate limited by Confluence${seconds ? ` — retry after ${seconds}s` : ""}`,
            429
          )
        );
      }
      if (response.status === 400) {
        const body = await response.json().catch(() => ({})) as Record<string, unknown>;
        const msg =
          typeof body === "object" &&
          body !== null &&
          "message" in body &&
          typeof body.message === "string"
            ? body.message
            : "Bad request";
        return err(validationError(msg));
      }
      if (response.status >= 500) {
        return err(
          integrationError("confluence", "Confluence server error", response.status)
        );
      }
      if (!response.ok) {
        return err(
          integrationError(
            "confluence",
            `Confluence API error: ${response.status}`,
            response.status
          )
        );
      }

      const data: unknown = await response.json();
      return ok(data);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return err(
          integrationError("confluence", "Confluence request timed out (10s)", 504)
        );
      }
      logger.error({ error }, "Confluence fetch failed");
      return err(
        integrationError("confluence", "Network error contacting Confluence", 502)
      );
    }
  }

  return {
    async searchPages(
      cql: string,
      maxResults: number
    ): Promise<
      Result<{ total: number; results: ConfluenceSearchResult[] }, DomainError>
    > {
      const cap = Math.min(Math.max(maxResults, 1), MAX_RESULTS_CAP);

      const authResult = await getAuthHeaders();
      if (authResult._tag === "Err") return authResult;
      const { siteUrl, headers } = authResult.value;

      // Inject space allowlist
      const allowedKeys = await getAllowedSpaceKeys();
      let effectiveCql = cql;
      if (allowedKeys.length > 0) {
        const spaceIn = allowedKeys.map((k) => `"${k}"`).join(",");
        effectiveCql = `space IN (${spaceIn}) AND (${cql})`;
      }

      const params = new URLSearchParams({
        cql: effectiveCql,
        limit: String(cap),
        expand: "space,version",
      });

      const fetchResult = await confluenceFetch(
        siteUrl,
        `content/search?${params.toString()}`,
        headers
      );
      if (fetchResult._tag === "Err") return fetchResult;

      const data = fetchResult.value as {
        totalSize?: number;
        results?: Array<{
          id?: string;
          title?: string;
          space?: { key?: string; name?: string };
          version?: { when?: string };
          excerpt?: string;
          _links?: { webui?: string };
        }>;
      };

      const results: ConfluenceSearchResult[] = (data.results ?? []).map(
        (r) => ({
          pageId: r.id ?? "",
          title: r.title ?? "",
          spaceKey: r.space?.key ?? "",
          spaceName: r.space?.name ?? "",
          url: r._links?.webui
            ? `${siteUrl}/wiki${r._links.webui}`
            : "",
          lastModified: r.version?.when ?? new Date().toISOString(),
          excerpt: r.excerpt ?? "",
        })
      );

      return ok({ total: data.totalSize ?? results.length, results });
    },

    async getPage(
      pageId: string
    ): Promise<Result<ConfluencePage, DomainError>> {
      const authResult = await getAuthHeaders();
      if (authResult._tag === "Err") return authResult;
      const { siteUrl, headers } = authResult.value;

      const expand =
        "body.storage,space,version,ancestors,history.lastUpdated";
      const fetchResult = await confluenceFetch(
        siteUrl,
        `content/${pageId}?expand=${expand}`,
        headers
      );
      if (fetchResult._tag === "Err") return fetchResult;

      const data = fetchResult.value as {
        id?: string;
        title?: string;
        space?: { key?: string; name?: string };
        version?: { number?: number; when?: string };
        history?: { lastUpdated?: { when?: string; by?: { displayName?: string; accountId?: string } } };
        body?: { storage?: { value?: string } };
        ancestors?: Array<{ id?: string; title?: string }>;
        _links?: { webui?: string };
      };

      // Allowlist check
      const spaceKey = data.space?.key ?? "";
      const allowedKeys = await getAllowedSpaceKeys();
      if (
        allowedKeys.length > 0 &&
        !allowedKeys.includes(spaceKey.toUpperCase())
      ) {
        return err(
          authorizationError(
            `Page belongs to space "${spaceKey}" which is not in the allowed space list`,
            "confluence"
          )
        );
      }

      // Content size guard
      const storageBody = data.body?.storage?.value ?? "";
      if (Buffer.byteLength(storageBody, "utf-8") > MAX_BODY_SIZE_BYTES) {
        return err(
          integrationError(
            "confluence",
            "Page body exceeds 500 KB — use confluence_search_pages for excerpts instead",
            413
          )
        );
      }

      // Convert XHTML storage format to Markdown
      let contentMarkdown: string;
      try {
        contentMarkdown = nhm.translate(storageBody);
      } catch (convErr) {
        logger.error(
          { pageId, bodyLength: storageBody.length },
          "Markdown conversion failed"
        );
        return err(
          integrationError(
            "confluence",
            "Failed to convert page content to Markdown",
            500
          )
        );
      }

      const lastUpdated = data.history?.lastUpdated;

      const page: ConfluencePage = {
        pageId: data.id ?? pageId,
        title: data.title ?? "",
        spaceKey,
        spaceName: data.space?.name ?? "",
        url: data._links?.webui
          ? `${siteUrl}/wiki${data._links.webui}`
          : "",
        version: data.version?.number ?? 1,
        lastModified:
          lastUpdated?.when ?? data.version?.when ?? new Date().toISOString(),
        author: {
          displayName: lastUpdated?.by?.displayName ?? "",
          accountId: lastUpdated?.by?.accountId ?? "",
        },
        contentMarkdown,
        ancestors: (data.ancestors ?? []).map((a) => ({
          id: a.id ?? "",
          title: a.title ?? "",
        })),
      };

      return ok(page);
    },

    async listSpaces(
      type: "global" | "personal" | "all",
      maxResults: number
    ): Promise<
      Result<{ total: number; spaces: ConfluenceSpace[] }, DomainError>
    > {
      const cap = Math.min(Math.max(maxResults, 1), MAX_RESULTS_CAP);

      const authResult = await getAuthHeaders();
      if (authResult._tag === "Err") return authResult;
      const { siteUrl, headers } = authResult.value;

      const params = new URLSearchParams({
        limit: String(cap),
        expand: "description.plain",
      });
      if (type !== "all") {
        params.set("type", type);
      }

      const fetchResult = await confluenceFetch(
        siteUrl,
        `space?${params.toString()}`,
        headers
      );
      if (fetchResult._tag === "Err") return fetchResult;

      const data = fetchResult.value as {
        results?: Array<{
          key?: string;
          name?: string;
          type?: string;
          _links?: { webui?: string };
          description?: { plain?: { value?: string } };
        }>;
      };

      let spaces: ConfluenceSpace[] = (data.results ?? []).map((s) => ({
        spaceKey: s.key ?? "",
        name: s.name ?? "",
        type: (s.type === "personal" ? "personal" : "global") as
          | "global"
          | "personal",
        url: s._links?.webui
          ? `${siteUrl}/wiki${s._links.webui}`
          : "",
        description: s.description?.plain?.value ?? null,
      }));

      // Filter by allowlist
      const allowedKeys = await getAllowedSpaceKeys();
      if (allowedKeys.length > 0) {
        spaces = spaces.filter((s) =>
          allowedKeys.includes(s.spaceKey.toUpperCase())
        );
      }

      return ok({ total: spaces.length, spaces });
    },
  };
}
