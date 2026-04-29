import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createToolHandlerRegistry,
  type ToolHandlerRegistry,
} from "./tool-handler-registry.js";
import type { Logger } from "pino";

function createLoggerStub(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe("toolHandlerRegistry jira_add_comment validation", () => {
  let registry: ToolHandlerRegistry;

  beforeEach(() => {
    registry = createToolHandlerRegistry({ logger: createLoggerStub() });
  });

  function registerAddCommentHandler(
    jiraService: { addComment: ReturnType<typeof vi.fn> }
  ) {
    const errText = (e: { message?: string }) => e.message ?? "Unknown error";

    registry.register(
      "jira_add_comment",
      "Add a comment to a Jira issue",
      {
        type: "object",
        properties: {
          issueKey: { type: "string" },
          body: { type: "string" },
          bodyMarkdown: { type: "string" },
          bodyAdf: { type: "object" },
          mentions: { type: "array", items: { type: "object" } },
        },
        required: ["issueKey"],
      },
      async (args) => {
        const bodyFieldCount = [args.body, args.bodyMarkdown, args.bodyAdf].filter(
          (v) => v !== undefined
        ).length;
        if (bodyFieldCount !== 1) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: Provide exactly one of body, bodyMarkdown, or bodyAdf",
              },
            ],
            isError: true,
          };
        }
        const result = await jiraService.addComment({
          issueKey: args.issueKey as string,
          ...(args.body !== undefined ? { body: args.body as string } : {}),
          ...(args.bodyMarkdown !== undefined
            ? { bodyMarkdown: args.bodyMarkdown as string }
            : {}),
          ...(args.bodyAdf !== undefined ? { bodyAdf: args.bodyAdf } : {}),
          ...(args.mentions !== undefined ? { mentions: args.mentions } : {}),
        });
        if (result._tag === "Err")
          return {
            content: [
              { type: "text" as const, text: `Error: ${errText(result.error)}` },
            ],
            isError: true,
          };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result.value, null, 2) },
          ],
        };
      }
    );
  }

  it("accepts a call with exactly one body field", async () => {
    const addComment = vi.fn().mockResolvedValue({
      _tag: "Ok",
      value: { id: "100", self: "https://jira/comment/100" },
    });
    registerAddCommentHandler({ addComment });

    const entry = registry.get("jira_add_comment");
    expect(entry).toBeDefined();

    const result = await entry!.handler({
      issueKey: "ENG-1",
      body: "Hello from agent",
    });

    expect(result.isError).toBeFalsy();
    expect(addComment).toHaveBeenCalledWith(
      expect.objectContaining({ issueKey: "ENG-1", body: "Hello from agent" })
    );
  });

  it("rejects a call with no body field", async () => {
    const addComment = vi.fn();
    registerAddCommentHandler({ addComment });

    const entry = registry.get("jira_add_comment")!;
    const result = await entry.handler({ issueKey: "ENG-2" });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("exactly one of body");
    expect(addComment).not.toHaveBeenCalled();
  });

  it("rejects a call with multiple body fields", async () => {
    const addComment = vi.fn();
    registerAddCommentHandler({ addComment });

    const entry = registry.get("jira_add_comment")!;
    const result = await entry.handler({
      issueKey: "ENG-3",
      body: "plain",
      bodyMarkdown: "# markdown",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("exactly one of body");
    expect(addComment).not.toHaveBeenCalled();
  });
});
