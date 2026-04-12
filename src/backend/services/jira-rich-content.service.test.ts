import { describe, expect, it } from "vitest";
import { normalizeJiraRichText } from "./jira-rich-content.service.js";

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
