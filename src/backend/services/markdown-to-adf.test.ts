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
