import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { createJiraService } from "./jira.service.js";
import { normalizeJiraRichText } from "./jira-rich-content.service.js";

function createLoggerStub(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe("jira-rich-content.service", () => {
  it("rejects conflicting markdown and ADF inputs", () => {
    const result = normalizeJiraRichText({
      markdown: "hello",
      adf: { type: "doc", version: 1, content: [] },
    });

    expect(result._tag).toBe("Err");
  });

  it("rejects invalid ADF payloads", () => {
    const result = normalizeJiraRichText({
      adf: { type: "paragraph" },
    });

    expect(result._tag).toBe("Err");
  });
});

describe("createJiraService", () => {
  const originalFetch = global.fetch;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("passes raw ADF comments through without conversion loss", async () => {
    const adfBody = {
      type: "doc" as const,
      version: 1 as const,
      content: [
        {
          type: "table",
          attrs: { isNumberColumnEnabled: false, layout: "default" },
          content: [],
        },
      ],
    };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "100", self: "https://jira/comment/100" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      })
    );

    const service = createJiraService({
      logger: createLoggerStub(),
      getConnectionInfo: async () => ({
        siteUrl: "https://example.atlassian.net",
        credentials: { email: "user@example.com", apiToken: "secret" },
      }),
    });

    const result = await service.addComment({
      issueKey: "ENG-1",
      bodyAdf: adfBody,
    });

    expect(result._tag).toBe("Ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("https://example.atlassian.net/rest/api/3/issue/ENG-1/comment");
    expect(request?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ body: adfBody });
  });

  it("builds a Jira edit payload for issue updates", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const service = createJiraService({
      logger: createLoggerStub(),
      getConnectionInfo: async () => ({
        siteUrl: "https://example.atlassian.net",
        credentials: { email: "user@example.com", apiToken: "secret" },
      }),
    });

    const result = await service.updateIssue({
      issueKey: "ENG-2",
      summary: "Updated summary",
      labels: ["jira", "mcp"],
      priority: "High",
      dueDate: "2026-04-18",
      descriptionMarkdown: "| Item | Status |\n| --- | --- |\n| API | Done |",
    });

    expect(result).toMatchObject({
      _tag: "Ok",
      value: {
        success: true,
        issueKey: "ENG-2",
        updatedFields: ["summary", "description", "labels", "priority", "dueDate"],
        mode: "markdown",
      },
    });

    const request = fetchMock.mock.calls[0];
    expect(request?.[0]).toBe("https://example.atlassian.net/rest/api/3/issue/ENG-2");
    expect(request?.[1]?.method).toBe("PUT");

    const body = JSON.parse(String(request?.[1]?.body)) as {
      fields: Record<string, unknown>;
    };

    expect(body.fields.summary).toBe("Updated summary");
    expect(body.fields.labels).toEqual(["jira", "mcp"]);
    expect(body.fields.priority).toEqual({ name: "High" });
    expect(body.fields.duedate).toBe("2026-04-18");
    expect(body.fields.description).toMatchObject({
      type: "doc",
      version: 1,
      content: [
        {
          type: "table",
        },
      ],
    });
  });
});
