import { describe, expect, it } from "vitest";
import { applyJiraCommentMentions } from "./jira-comment-mentions.service.js";

describe("jira-comment-mentions.service", () => {
  const resolvedBob = {
    placeholder: "[[bob]]",
    displayName: "Bob Example",
    user: {
      accountId: "acct-123",
      displayName: "Bob Example",
    },
  };

  const resolvedAlice = {
    placeholder: "[[alice]]",
    displayName: "Alice Example",
    user: {
      accountId: "acct-456",
      displayName: "Alice Example",
    },
  };

  it("replaces multiple placeholders in a single text node and preserves marks", () => {
    const result = applyJiraCommentMentions(
      {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Owners: [[bob]] and [[alice]]",
                marks: [{ type: "strong" }],
              },
            ],
          },
        ],
      },
      [resolvedBob, resolvedAlice]
    );

    expect(result._tag).toBe("Ok");
    if (result._tag === "Ok") {
      const content = result.value.content[0] as { content: Array<Record<string, unknown>> };
      expect(content.content[0]).toMatchObject({
        type: "text",
        text: "Owners: ",
        marks: [{ type: "strong" }],
      });
      expect(content.content[1]).toMatchObject({
        type: "mention",
        attrs: { id: "acct-123", text: "@Bob Example" },
      });
      expect(content.content[2]).toMatchObject({
        type: "text",
        text: " and ",
        marks: [{ type: "strong" }],
      });
      expect(content.content[3]).toMatchObject({
        type: "mention",
        attrs: { id: "acct-456", text: "@Alice Example" },
      });
    }
  });

  it("replaces placeholders nested inside block content", () => {
    const result = applyJiraCommentMentions(
      {
        type: "doc",
        version: 1,
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "paragraph",
                content: [
                  { type: "text", text: "Escalate to [[bob]]" },
                ],
              },
            ],
          },
        ],
      },
      [resolvedBob]
    );

    expect(result._tag).toBe("Ok");
    if (result._tag === "Ok") {
      const quote = result.value.content[0] as { content: Array<{ content: Array<Record<string, unknown>> }> };
      expect(quote.content[0]?.content[1]).toMatchObject({
        type: "mention",
        attrs: { id: "acct-123", text: "@Bob Example" },
      });
    }
  });

  it("rejects duplicate mention placeholders", () => {
    const result = applyJiraCommentMentions(
      {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "[[bob]]" }] }],
      },
      [resolvedBob, resolvedBob]
    );

    expect(result._tag).toBe("Err");
    if (result._tag === "Err" && result.error._tag === "ValidationError") {
      expect(result.error.message).toContain("Duplicate mention placeholder");
    }
  });

  it("rejects missing placeholders", () => {
    const result = applyJiraCommentMentions(
      {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: "No mentions here" }] }],
      },
      [resolvedBob]
    );

    expect(result._tag).toBe("Err");
    if (result._tag === "Err" && result.error._tag === "ValidationError") {
      expect(result.error.message).toContain("Mention placeholder not found");
    }
  });

  it("handles empty content arrays without mutation", () => {
    const result = applyJiraCommentMentions(
      {
        type: "doc",
        version: 1,
        content: [],
      },
      []
    );

    expect(result).toMatchObject({
      _tag: "Ok",
      value: {
        type: "doc",
        version: 1,
        content: [],
      },
    });
  });
});
