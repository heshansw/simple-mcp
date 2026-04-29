import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  AddCommentInputSchema,
  registerAddCommentTool,
  type AddCommentToolDeps,
} from "./add-comment.tool.js";
import { ok, err, integrationError, validationError } from "@shared/result.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(overrides: Partial<AddCommentToolDeps> = {}): AddCommentToolDeps {
  return {
    jiraService: {
      addComment: vi.fn().mockResolvedValue(
        ok({ id: "10001", self: "https://jira.example.com/rest/api/3/issue/ENG-1/comment/10001" })
      ),
    },
    connectionManager: { getConnection: vi.fn().mockReturnValue({}) },
    logger: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

async function setupMcpToolTest(deps: AddCommentToolDeps) {
  const server = new McpServer({ name: "test-server", version: "0.0.1" });
  registerAddCommentTool(server, deps);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.1" });

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client, server };
}

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe("AddCommentInputSchema", () => {
  describe("acceptance", () => {
    it("accepts body only", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "ENG-1",
        body: "Hello world",
      });
      expect(result.success).toBe(true);
    });

    it("accepts bodyMarkdown only", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "ENG-2",
        bodyMarkdown: "# Heading\nsome content",
      });
      expect(result.success).toBe(true);
    });

    it("accepts bodyAdf only", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "ENG-3",
        bodyAdf: {
          type: "doc",
          version: 1,
          content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts body with mentions", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "ENG-4",
        body: "cc [[bob]]",
        mentions: [{ placeholder: "[[bob]]", displayName: "Bob Example" }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("rejection", () => {
    it("rejects when no body field is provided", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "ENG-1",
      });
      expect(result.success).toBe(false);
    });

    it("rejects when multiple body fields are provided", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "ENG-1",
        body: "hello",
        bodyMarkdown: "# hello",
      });
      expect(result.success).toBe(false);
    });

    it("rejects all three body fields", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "ENG-1",
        body: "hello",
        bodyMarkdown: "# hello",
        bodyAdf: { type: "doc", version: 1, content: [] },
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing issueKey", () => {
      const result = AddCommentInputSchema.safeParse({
        body: "Hello",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty issueKey", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "",
        body: "Hello",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty body string", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "ENG-1",
        body: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty bodyMarkdown string", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "ENG-1",
        bodyMarkdown: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid bodyAdf structure", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "ENG-1",
        bodyAdf: { type: "not-doc", version: 1, content: [] },
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty mentions array", () => {
      const result = AddCommentInputSchema.safeParse({
        issueKey: "ENG-1",
        body: "some text",
        mentions: [],
      });
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Tool handler integration tests (via MCP transport)
// ---------------------------------------------------------------------------

describe("registerAddCommentTool (MCP transport)", () => {
  let deps: AddCommentToolDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it("is listed with the correct name and description", async () => {
    const { client } = await setupMcpToolTest(deps);
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "jira_add_comment");

    expect(tool).toBeDefined();
    expect(tool?.description).toContain("Add a comment");
  });

  describe("happy path", () => {
    it("adds a comment with body (legacy markdown)", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "jira_add_comment",
        arguments: { issueKey: "ENG-1", body: "This is a test comment" },
      });

      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      const parsed = JSON.parse(text);
      expect(parsed.success).toBe(true);
      expect(parsed.result).toMatchObject({ id: "10001" });

      expect(deps.jiraService.addComment).toHaveBeenCalledWith(
        expect.objectContaining({ issueKey: "ENG-1", body: "This is a test comment" })
      );
    });

    it("adds a comment with bodyMarkdown", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "jira_add_comment",
        arguments: { issueKey: "ENG-2", bodyMarkdown: "## Heading\n- item 1\n- item 2" },
      });

      expect(result.isError).toBeFalsy();
      expect(deps.jiraService.addComment).toHaveBeenCalledWith(
        expect.objectContaining({ issueKey: "ENG-2", bodyMarkdown: "## Heading\n- item 1\n- item 2" })
      );
    });

    it("adds a comment with bodyAdf", async () => {
      const adfDoc = {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "ADF comment" }] }],
      };

      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "jira_add_comment",
        arguments: { issueKey: "ENG-3", bodyAdf: adfDoc },
      });

      expect(result.isError).toBeFalsy();
      expect(deps.jiraService.addComment).toHaveBeenCalledWith(
        expect.objectContaining({ issueKey: "ENG-3", bodyAdf: adfDoc })
      );
    });

    it("passes mentions through to the service", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "jira_add_comment",
        arguments: {
          issueKey: "ENG-4",
          body: "cc [[alice]]",
          mentions: [{ placeholder: "[[alice]]", displayName: "Alice" }],
        },
      });

      expect(result.isError).toBeFalsy();
      expect(deps.jiraService.addComment).toHaveBeenCalledWith(
        expect.objectContaining({
          issueKey: "ENG-4",
          body: "cc [[alice]]",
          mentions: [{ placeholder: "[[alice]]", displayName: "Alice" }],
        })
      );
    });
  });

  describe("error cases", () => {
    it("returns isError when service returns Err", async () => {
      const failDeps = createMockDeps({
        jiraService: {
          addComment: vi.fn().mockResolvedValue(
            err(integrationError("jira", "HTTP 403: Forbidden"))
          ),
        },
      });
      const { client } = await setupMcpToolTest(failDeps);

      const result = await client.callTool({
        name: "jira_add_comment",
        arguments: { issueKey: "ENG-DENIED", body: "hello" },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Failed to add comment");
    });

    it("returns isError when service returns ValidationError", async () => {
      const failDeps = createMockDeps({
        jiraService: {
          addComment: vi.fn().mockResolvedValue(
            err(validationError("Mention placeholder not found in body text"))
          ),
        },
      });
      const { client } = await setupMcpToolTest(failDeps);

      const result = await client.callTool({
        name: "jira_add_comment",
        arguments: { issueKey: "ENG-5", body: "oops" },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("Mention placeholder not found");
    });

    it("returns isError when service throws unexpectedly", async () => {
      const failDeps = createMockDeps({
        jiraService: {
          addComment: vi.fn().mockRejectedValue(new Error("network failure")),
        },
      });
      const { client } = await setupMcpToolTest(failDeps);

      const result = await client.callTool({
        name: "jira_add_comment",
        arguments: { issueKey: "ENG-6", body: "boom" },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      expect(text).toContain("network failure");
    });

    it("rejects call with no body fields via MCP validation", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "jira_add_comment",
        arguments: { issueKey: "ENG-7" },
      });

      // The superRefine check in the handler catches this
      expect(result.isError).toBe(true);
      expect(deps.jiraService.addComment).not.toHaveBeenCalled();
    });

    it("rejects call with multiple body fields", async () => {
      const { client } = await setupMcpToolTest(deps);

      const result = await client.callTool({
        name: "jira_add_comment",
        arguments: {
          issueKey: "ENG-8",
          body: "plain text",
          bodyMarkdown: "# markdown",
        },
      });

      expect(result.isError).toBe(true);
      expect(deps.jiraService.addComment).not.toHaveBeenCalled();
    });
  });
});
