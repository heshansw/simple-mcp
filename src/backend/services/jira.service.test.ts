import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "pino";
import { createJiraService } from "./jira.service.js";

function createLoggerStub(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

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

  it("resolves mention placeholders into Jira mention nodes", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify([
          {
            accountId: "acct-123",
            displayName: "Bob Example",
            emailAddress: "bob@example.com",
          },
        ]), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "101", self: "https://jira/comment/101" }), {
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
      issueKey: "ENG-3",
      bodyMarkdown: "Pairing with [[bob]] on this change.",
      mentions: [
        {
          placeholder: "[[bob]]",
          displayName: "Bob Example",
        },
      ],
    });

    expect(result._tag).toBe("Ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const request = fetchMock.mock.calls[1];
    const body = JSON.parse(String(request?.[1]?.body)) as {
      body: {
        type: string;
        version: number;
        content: Array<{ type: string; content?: Array<{ type: string; attrs?: { id?: string; text?: string } }> }>;
      };
    };

    expect(body.body.type).toBe("doc");
    expect(body.body.content[0]?.type).toBe("paragraph");
    expect(body.body.content[0]?.content).toContainEqual({
      type: "mention",
      attrs: {
        id: "acct-123",
        text: "@Bob Example",
      },
    });
  });

  it("fails comment creation when a mention placeholder is missing from the body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([
        {
          accountId: "acct-123",
          displayName: "Bob Example",
        },
      ]), {
        status: 200,
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
      issueKey: "ENG-4",
      bodyMarkdown: "No inline mention placeholder here.",
      mentions: [
        {
          placeholder: "[[bob]]",
          displayName: "Bob Example",
        },
      ],
    });

    expect(result._tag).toBe("Err");
    if (result._tag === "Err") {
      const { error } = result;
      expect(error._tag).toBe("ValidationError");
      if (error._tag === "ValidationError") {
        expect(error.message).toContain("Mention placeholder not found");
      }
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("finds Jira users by display name with exact resolution", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([
        {
          accountId: "acct-123",
          displayName: "Bob Example",
          emailAddress: "bob@example.com",
        },
      ]), {
        status: 200,
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

    const result = await service.findUsers({
      displayName: "Bob Example",
    });

    expect(result).toMatchObject({
      _tag: "Ok",
      value: {
        resolution: "exact",
        matches: [
          {
            accountId: "acct-123",
            displayName: "Bob Example",
          },
        ],
      },
    });
  });

  it("returns not_found when Jira user search has no matches", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([]), {
        status: 200,
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

    const result = await service.findUsers({
      displayName: "Missing User",
    });

    expect(result).toMatchObject({
      _tag: "Ok",
      value: {
        resolution: "not_found",
        matches: [],
      },
    });
  });

  it("fails assignment when Jira user resolution is ambiguous", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([
        { accountId: "acct-123", displayName: "Bob Example" },
        { accountId: "acct-456", displayName: "Bob Example" },
      ]), {
        status: 200,
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

    const result = await service.assignIssue({
      issueKey: "ENG-AMB",
      assigneeDisplayName: "Bob Example",
    });

    expect(result._tag).toBe("Err");
    if (result._tag === "Err") {
      expect(result.error._tag).toBe("ValidationError");
    }
  });

  it("assigns an issue by resolved display name", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify([
          {
            accountId: "acct-123",
            displayName: "Bob Example",
            emailAddress: "bob@example.com",
          },
        ]), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const service = createJiraService({
      logger: createLoggerStub(),
      getConnectionInfo: async () => ({
        siteUrl: "https://example.atlassian.net",
        credentials: { email: "user@example.com", apiToken: "secret" },
      }),
    });

    const result = await service.assignIssue({
      issueKey: "ENG-5",
      assigneeDisplayName: "Bob Example",
    });

    expect(result).toMatchObject({
      _tag: "Ok",
      value: {
        success: true,
        issueKey: "ENG-5",
        assignee: {
          accountId: "acct-123",
          displayName: "Bob Example",
        },
        resolutionMode: "exact",
      },
    });

    const request = fetchMock.mock.calls[1];
    expect(request?.[0]).toBe("https://example.atlassian.net/rest/api/3/issue/ENG-5");
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      fields: {
        assignee: { accountId: "acct-123" },
      },
    });
  });

  it("unassigns an issue when unassign is true", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const service = createJiraService({
      logger: createLoggerStub(),
      getConnectionInfo: async () => ({
        siteUrl: "https://example.atlassian.net",
        credentials: { email: "user@example.com", apiToken: "secret" },
      }),
    });

    const result = await service.assignIssue({
      issueKey: "ENG-UNASSIGN",
      unassign: true,
    });

    expect(result).toMatchObject({
      _tag: "Ok",
      value: {
        success: true,
        issueKey: "ENG-UNASSIGN",
        assignee: null,
        resolutionMode: "explicit_unassign",
      },
    });

    const request = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      fields: {
        assignee: null,
      },
    });
  });

  it("changes issue status by target status name", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          transitions: [
            {
              id: "31",
              name: "Start Progress",
              to: { id: "3", name: "In Progress" },
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const service = createJiraService({
      logger: createLoggerStub(),
      getConnectionInfo: async () => ({
        siteUrl: "https://example.atlassian.net",
        credentials: { email: "user@example.com", apiToken: "secret" },
      }),
    });

    const result = await service.changeIssueStatus("ENG-6", "In Progress");

    expect(result).toMatchObject({
      _tag: "Ok",
      value: {
        success: true,
        issueKey: "ENG-6",
        transitionId: "31",
        transitionName: "Start Progress",
        toStatusName: "In Progress",
      },
    });
  });

  it("fails status change when the requested status is unreachable", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        transitions: [
          {
            id: "41",
            name: "Close",
            to: { id: "5", name: "Done" },
          },
        ],
      }), {
        status: 200,
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

    const result = await service.changeIssueStatus("ENG-7", "In Progress");

    expect(result._tag).toBe("Err");
    if (result._tag === "Err" && result.error._tag === "ValidationError") {
      expect(result.error.message).toContain("Available statuses: Done");
    }
  });

  it("fails status change when multiple transitions match the requested status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        transitions: [
          {
            id: "31",
            name: "Start Progress",
            to: { id: "3", name: "In Progress" },
          },
          {
            id: "32",
            name: "Resume Progress",
            to: { id: "3", name: "In Progress" },
          },
        ],
      }), {
        status: 200,
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

    const result = await service.changeIssueStatus("ENG-8", "In Progress");

    expect(result._tag).toBe("Err");
    if (result._tag === "Err" && result.error._tag === "ValidationError") {
      expect(result.error.message).toContain("Multiple Jira transitions match");
    }
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
