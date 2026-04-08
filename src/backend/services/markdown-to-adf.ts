/**
 * Converts a markdown string into Jira Cloud's Atlassian Document Format (ADF).
 *
 * Supported markdown:
 * - Headings: # through ######
 * - Bullet lists: - or *
 * - Ordered lists: 1. 2. 3.
 * - Task lists: - [ ] item / - [x] item
 * - Tables: GitHub-style pipe tables
 * - Code blocks: ```lang\n...\n```
 * - Blockquotes: > text
 * - Horizontal rules: --- or ***
 * - Inline marks: **bold**, *italic*, ~~strikethrough~~, `code`, [text](url)
 * - Plain paragraphs
 */

import type { JiraAdfDocument } from "@shared/schemas/jira.schema.js";

type AdfMark = {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
};

type AdfTextNode = {
  readonly type: "text";
  readonly text: string;
  readonly marks?: AdfMark[];
};

type AdfInlineNode = AdfTextNode | { readonly type: "hardBreak" };

type AdfParagraphNode = {
  readonly type: "paragraph";
  readonly content: AdfInlineNode[];
};

type AdfHeadingNode = {
  readonly type: "heading";
  readonly attrs: { readonly level: number };
  readonly content: AdfInlineNode[];
};

type AdfCodeBlockNode = {
  readonly type: "codeBlock";
  readonly attrs: { readonly language: string };
  readonly content: AdfInlineNode[];
};

type AdfBlockquoteNode = {
  readonly type: "blockquote";
  readonly content: AdfBlockNode[];
};

type AdfListItem = {
  readonly type: "listItem";
  readonly content: AdfBlockNode[];
};

type AdfBulletListNode = {
  readonly type: "bulletList";
  readonly content: AdfListItem[];
};

type AdfOrderedListNode = {
  readonly type: "orderedList";
  readonly content: AdfListItem[];
};

type AdfTaskItemNode = {
  readonly type: "taskItem";
  readonly attrs: { readonly state: "TODO" | "DONE"; readonly localId: string };
  readonly content: AdfParagraphNode[];
};

type AdfTaskListNode = {
  readonly type: "taskList";
  readonly content: AdfTaskItemNode[];
};

type AdfTableCellNode = {
  readonly type: "tableCell" | "tableHeader";
  readonly attrs?: { readonly colspan?: number; readonly rowspan?: number };
  readonly content: AdfParagraphNode[];
};

type AdfTableRowNode = {
  readonly type: "tableRow";
  readonly content: AdfTableCellNode[];
};

type AdfTableNode = {
  readonly type: "table";
  readonly attrs: { readonly isNumberColumnEnabled: boolean; readonly layout: "default" };
  readonly content: AdfTableRowNode[];
};

type AdfRuleNode = {
  readonly type: "rule";
};

type AdfBlockNode =
  | AdfParagraphNode
  | AdfHeadingNode
  | AdfCodeBlockNode
  | AdfBlockquoteNode
  | AdfBulletListNode
  | AdfOrderedListNode
  | AdfTaskListNode
  | AdfTableNode
  | AdfRuleNode;

function createParagraph(text: string): AdfParagraphNode {
  return {
    type: "paragraph",
    content: parseInlineContent(text),
  };
}

function createTaskId(index: number): string {
  return `task-${index}-${Math.random().toString(36).slice(2, 10)}`;
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseInlineContent(text: string): AdfInlineNode[] {
  const nodes: AdfInlineNode[] = [];
  const parts = text.split("\n");

  parts.forEach((part, partIndex) => {
    if (partIndex > 0) {
      nodes.push({ type: "hardBreak" });
    }

    const inlineRegex =
      /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(__(.+?)__)|(_(.+?)_)|(~~(.+?)~~)|(`([^`]+?)`)|(\[([^\]]+)\]\(([^)]+)\))/g;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = inlineRegex.exec(part)) !== null) {
      if (match.index > lastIndex) {
        const preceding = part.slice(lastIndex, match.index);
        if (preceding) {
          nodes.push({ type: "text", text: preceding });
        }
      }

      if (match[1] && match[2]) {
        nodes.push({ type: "text", text: match[2], marks: [{ type: "strong" }] });
      } else if (match[3] && match[4]) {
        nodes.push({ type: "text", text: match[4], marks: [{ type: "em" }] });
      } else if (match[5] && match[6]) {
        nodes.push({ type: "text", text: match[6], marks: [{ type: "strong" }] });
      } else if (match[7] && match[8]) {
        nodes.push({ type: "text", text: match[8], marks: [{ type: "em" }] });
      } else if (match[9] && match[10]) {
        nodes.push({ type: "text", text: match[10], marks: [{ type: "strike" }] });
      } else if (match[11] && match[12]) {
        nodes.push({ type: "text", text: match[12], marks: [{ type: "code" }] });
      } else if (match[13] && match[14] && match[15]) {
        nodes.push({
          type: "text",
          text: match[14],
          marks: [{ type: "link", attrs: { href: match[15] } }],
        });
      }

      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < part.length) {
      nodes.push({ type: "text", text: part.slice(lastIndex) });
    }
  });

  if (nodes.length === 0 && text.length > 0) {
    nodes.push({ type: "text", text });
  }

  return nodes;
}

export function markdownToAdf(markdown: string): JiraAdfDocument {
  const lines = markdown.split("\n");
  const content: AdfBlockNode[] = [];
  let i = 0;
  let taskCounter = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line !== undefined && line.startsWith("```")) {
      const language = line.slice(3).trim() || "plain";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== undefined && !(lines[i] as string).startsWith("```")) {
        codeLines.push(lines[i] as string);
        i++;
      }
      i++;
      content.push({
        type: "codeBlock",
        attrs: { language },
        content: codeLines.length > 0 ? [{ type: "text", text: codeLines.join("\n") }] : [],
      });
      continue;
    }

    if (line !== undefined && /^(\s*[-*_]\s*){3,}$/.test(line)) {
      content.push({ type: "rule" });
      i++;
      continue;
    }

    if (
      line !== undefined &&
      i + 1 < lines.length &&
      line.includes("|") &&
      (lines[i + 1] as string | undefined)?.includes("|") &&
      isTableSeparator(lines[i + 1] as string)
    ) {
      const headerCells = splitTableRow(line);
      const rowNodes: AdfTableRowNode[] = [
        {
          type: "tableRow",
          content: headerCells.map((cell) => ({
            type: "tableHeader",
            content: [createParagraph(cell)],
          })),
        },
      ];

      i += 2;
      while (
        i < lines.length &&
        lines[i] !== undefined &&
        (lines[i] as string).trim() !== "" &&
        (lines[i] as string).includes("|")
      ) {
        const rowCells = splitTableRow(lines[i] as string);
        rowNodes.push({
          type: "tableRow",
          content: rowCells.map((cell) => ({
            type: "tableCell",
            content: [createParagraph(cell)],
          })),
        });
        i++;
      }

      content.push({
        type: "table",
        attrs: {
          isNumberColumnEnabled: false,
          layout: "default",
        },
        content: rowNodes,
      });
      continue;
    }

    if (line !== undefined) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch && headingMatch[1] && headingMatch[2]) {
        content.push({
          type: "heading",
          attrs: { level: headingMatch[1].length },
          content: parseInlineContent(headingMatch[2]),
        });
        i++;
        continue;
      }
    }

    if (line !== undefined && /^\s*[-*]\s+\[( |x|X)\]\s+/.test(line)) {
      const items: AdfTaskItemNode[] = [];
      while (
        i < lines.length &&
        lines[i] !== undefined &&
        /^\s*[-*]\s+\[( |x|X)\]\s+/.test(lines[i] as string)
      ) {
        const itemLine = lines[i] as string;
        const match = itemLine.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/);
        if (match && match[2]) {
          items.push({
            type: "taskItem",
            attrs: {
              state: match[1]?.toLowerCase() === "x" ? "DONE" : "TODO",
              localId: createTaskId(taskCounter),
            },
            content: [createParagraph(match[2])],
          });
          taskCounter++;
        }
        i++;
      }
      content.push({ type: "taskList", content: items });
      continue;
    }

    if (line !== undefined && /^\s*[-*]\s+/.test(line)) {
      const items: AdfListItem[] = [];
      while (i < lines.length && lines[i] !== undefined && /^\s*[-*]\s+/.test(lines[i] as string)) {
        const itemText = (lines[i] as string).replace(/^\s*[-*]\s+/, "");
        items.push({
          type: "listItem",
          content: [createParagraph(itemText)],
        });
        i++;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    if (line !== undefined && /^\s*\d+\.\s+/.test(line)) {
      const items: AdfListItem[] = [];
      while (
        i < lines.length &&
        lines[i] !== undefined &&
        /^\s*\d+\.\s+/.test(lines[i] as string)
      ) {
        const itemText = (lines[i] as string).replace(/^\s*\d+\.\s+/, "");
        items.push({
          type: "listItem",
          content: [createParagraph(itemText)],
        });
        i++;
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }

    if (line !== undefined && /^>\s*/.test(line)) {
      const quoteBlocks: AdfBlockNode[] = [];
      while (i < lines.length && lines[i] !== undefined && /^>\s*/.test(lines[i] as string)) {
        const quoteText = (lines[i] as string).replace(/^>\s*/, "");
        if (quoteText) {
          quoteBlocks.push(createParagraph(quoteText));
        }
        i++;
      }
      if (quoteBlocks.length > 0) {
        content.push({ type: "blockquote", content: quoteBlocks });
      }
      continue;
    }

    if (line !== undefined && line.trim() === "") {
      i++;
      continue;
    }

    if (line !== undefined) {
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i] !== undefined &&
        (lines[i] as string).trim() !== "" &&
        !/^(#{1,6}\s|[-*]\s+\[( |x|X)\]\s+|[-*]\s+|\d+\.\s+|>\s*|```|(\s*[-*_]\s*){3,}$)/.test(lines[i] as string) &&
        !(
          (lines[i] as string).includes("|") &&
          i + 1 < lines.length &&
          (lines[i + 1] as string | undefined)?.includes("|") &&
          isTableSeparator(lines[i + 1] as string)
        )
      ) {
        paraLines.push(lines[i] as string);
        i++;
      }
      if (paraLines.length > 0) {
        content.push(createParagraph(paraLines.join("\n")));
      }
      continue;
    }

    i++;
  }

  if (content.length === 0) {
    content.push(createParagraph(" "));
  }

  return {
    type: "doc",
    version: 1,
    content,
  };
}
