import { describe, expect, it } from "vitest";
import { markdownToAdf } from "./markdown-to-adf.js";

describe("markdownToAdf", () => {
  it("converts markdown tables into ADF table nodes", () => {
    const document = markdownToAdf(
      "| Item | Status |\n| --- | --- |\n| API | Done |\n| UI | Pending |"
    );

    expect(document.content[0]).toMatchObject({ type: "table" });
    const table = document.content[0] as {
      type: string;
      content: Array<{ type: string; content: Array<{ type: string }> }>;
    };

    expect(table.content).toHaveLength(3);
    expect(table.content[0]?.content.map((cell) => cell.type)).toEqual([
      "tableHeader",
      "tableHeader",
    ]);
    expect(table.content[1]?.content.map((cell) => cell.type)).toEqual([
      "tableCell",
      "tableCell",
    ]);
  });

  it("does not treat underscores inside words as emphasis", () => {
    const document = markdownToAdf(
      "The customer_retailer_domains table needs a schema change."
    );

    expect(document.content).toHaveLength(1);
    const para = document.content[0] as {
      type: string;
      content: Array<{ type: string; text: string; marks?: unknown[] }>;
    };
    expect(para.type).toBe("paragraph");
    // Should be a single text node with no marks — underscores are NOT italic
    expect(para.content).toHaveLength(1);
    expect(para.content[0]?.text).toBe(
      "The customer_retailer_domains table needs a schema change."
    );
    expect(para.content[0]?.marks).toBeUndefined();
  });

  it("still converts standalone _italic_ with underscores", () => {
    const document = markdownToAdf("This is _italic_ text");

    const para = document.content[0] as {
      type: string;
      content: Array<{ type: string; text: string; marks?: Array<{ type: string }> }>;
    };
    expect(para.content).toContainEqual({
      type: "text",
      text: "italic",
      marks: [{ type: "em" }],
    });
  });

  it("still converts standalone __bold__ with underscores", () => {
    const document = markdownToAdf("This is __bold__ text");

    const para = document.content[0] as {
      type: string;
      content: Array<{ type: string; text: string; marks?: Array<{ type: string }> }>;
    };
    expect(para.content).toContainEqual({
      type: "text",
      text: "bold",
      marks: [{ type: "strong" }],
    });
  });

  it("does not treat double underscores inside identifiers as bold", () => {
    const document = markdownToAdf("Use the __init__ method in my_class__factory");

    const para = document.content[0] as {
      type: string;
      content: Array<{ type: string; text: string; marks?: unknown[] }>;
    };
    // __init__ at start of word boundary IS bold (preceded by space)
    // but my_class__factory should NOT be treated as bold
    const boldNodes = para.content.filter(
      (n) => Array.isArray(n.marks) && n.marks.some((m: unknown) => (m as { type: string }).type === "strong")
    );
    // Only __init__ should be bold
    expect(boldNodes).toHaveLength(1);
    expect(boldNodes[0]?.text).toBe("init");
  });

  it("handles multiple underscored identifiers in one line", () => {
    const document = markdownToAdf(
      "Map user_id to account_id in the customer_table"
    );

    const para = document.content[0] as {
      type: string;
      content: Array<{ type: string; text: string; marks?: unknown[] }>;
    };
    // All text should be plain — no italic marks
    const italicNodes = para.content.filter(
      (n) => Array.isArray(n.marks) && n.marks.some((m: unknown) => (m as { type: string }).type === "em")
    );
    expect(italicNodes).toHaveLength(0);
  });

  it("converts markdown task lists into ADF task lists", () => {
    const document = markdownToAdf("- [ ] Write tests\n- [x] Ship feature");

    expect(document.content[0]).toMatchObject({
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { state: "TODO" },
        },
        {
          type: "taskItem",
          attrs: { state: "DONE" },
        },
      ],
    });
  });
});
