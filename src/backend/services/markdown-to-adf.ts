/**
 * Converts a markdown string into Jira Cloud's Atlassian Document Format (ADF).
 *
 * Supported markdown:
 * - Headings: # through ######
 * - Bullet lists: - or *
 * - Ordered lists: 1. 2. 3.
 * - Code blocks: ```lang\n...\n```
 * - Blockquotes: > text
 * - Horizontal rules: --- or ***
 * - Inline marks: **bold**, *italic*, ~~strikethrough~~, `code`, [text](url)
 * - Plain paragraphs
 */

// ── ADF node types ──────────────────────────────────────────────────

type AdfMark = {
  readonly type: string;
  readonly attrs?: Record<string, unknown>;
};

type AdfInlineNode = {
  readonly type: "text";
  readonly text: string;
  readonly marks?: AdfMark[];
} | {
  readonly type: "hardBreak";
};

type AdfBlockNode =
  | { readonly type: "paragraph"; readonly content: AdfInlineNode[] }
  | { readonly type: "heading"; readonly attrs: { readonly level: number }; readonly content: AdfInlineNode[] }
  | { readonly type: "codeBlock"; readonly attrs: { readonly language: string }; readonly content: AdfInlineNode[] }
  | { readonly type: "blockquote"; readonly content: AdfBlockNode[] }
  | { readonly type: "bulletList"; readonly content: AdfListItem[] }
  | { readonly type: "orderedList"; readonly content: AdfListItem[] }
  | { readonly type: "rule" };

type AdfListItem = {
  readonly type: "listItem";
  readonly content: AdfBlockNode[];
};

type AdfDocument = {
  readonly type: "doc";
  readonly version: 1;
  readonly content: AdfBlockNode[];
};

// ── Inline parsing ──────────────────────────────────────────────────

/**
 * Parse inline markdown into ADF inline nodes.
 * Handles: **bold**, *italic*, ~~strikethrough~~, `code`, [text](url)
 */
function parseInlineContent(text: string): AdfInlineNode[] {
  const nodes: AdfInlineNode[] = [];

  // Regex matches inline patterns in priority order
  const inlineRegex =
    /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(__(.+?)__)|(_(.+?)_)|(~~(.+?)~~)|(`([^`]+?)`)|(\[([^\]]+)\]\(([^)]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    // Add preceding plain text
    if (match.index > lastIndex) {
      const preceding = text.slice(lastIndex, match.index);
      if (preceding) {
        nodes.push({ type: "text", text: preceding });
      }
    }

    if (match[1] && match[2]) {
      // **bold**
      nodes.push({ type: "text", text: match[2], marks: [{ type: "strong" }] });
    } else if (match[3] && match[4]) {
      // *italic*
      nodes.push({ type: "text", text: match[4], marks: [{ type: "em" }] });
    } else if (match[5] && match[6]) {
      // __bold__
      nodes.push({ type: "text", text: match[6], marks: [{ type: "strong" }] });
    } else if (match[7] && match[8]) {
      // _italic_
      nodes.push({ type: "text", text: match[8], marks: [{ type: "em" }] });
    } else if (match[9] && match[10]) {
      // ~~strikethrough~~
      nodes.push({ type: "text", text: match[10], marks: [{ type: "strike" }] });
    } else if (match[11] && match[12]) {
      // `inline code`
      nodes.push({ type: "text", text: match[12], marks: [{ type: "code" }] });
    } else if (match[13] && match[14] && match[15]) {
      // [text](url)
      nodes.push({
        type: "text",
        text: match[14],
        marks: [{ type: "link", attrs: { href: match[15] } }],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add trailing plain text
  if (lastIndex < text.length) {
    const trailing = text.slice(lastIndex);
    if (trailing) {
      nodes.push({ type: "text", text: trailing });
    }
  }

  // If nothing was parsed, return the whole text as a single node
  if (nodes.length === 0 && text.length > 0) {
    nodes.push({ type: "text", text });
  }

  return nodes;
}

// ── Block parsing ───────────────────────────────────────────────────

export function markdownToAdf(markdown: string): AdfDocument {
  const lines = markdown.split("\n");
  const content: AdfBlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block: ```lang
    if (line !== undefined && line.startsWith("```")) {
      const language = line.slice(3).trim() || "plain";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && lines[i] !== undefined && !(lines[i] as string).startsWith("```")) {
        codeLines.push(lines[i] as string);
        i++;
      }
      i++; // skip closing ```
      const codeText = codeLines.join("\n");
      content.push({
        type: "codeBlock",
        attrs: { language },
        content: codeText ? [{ type: "text", text: codeText }] : [],
      });
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (line !== undefined && /^(\s*[-*_]\s*){3,}$/.test(line)) {
      content.push({ type: "rule" });
      i++;
      continue;
    }

    // Heading: # through ######
    if (line !== undefined) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch && headingMatch[1] && headingMatch[2]) {
        const level = headingMatch[1].length;
        content.push({
          type: "heading",
          attrs: { level },
          content: parseInlineContent(headingMatch[2]),
        });
        i++;
        continue;
      }
    }

    // Bullet list: - item or * item
    if (line !== undefined && /^\s*[-*]\s+/.test(line)) {
      const items: AdfListItem[] = [];
      while (i < lines.length && lines[i] !== undefined && /^\s*[-*]\s+/.test(lines[i] as string)) {
        const itemText = (lines[i] as string).replace(/^\s*[-*]\s+/, "");
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInlineContent(itemText) }],
        });
        i++;
      }
      content.push({ type: "bulletList", content: items });
      continue;
    }

    // Ordered list: 1. item
    if (line !== undefined && /^\s*\d+\.\s+/.test(line)) {
      const items: AdfListItem[] = [];
      while (i < lines.length && lines[i] !== undefined && /^\s*\d+\.\s+/.test(lines[i] as string)) {
        const itemText = (lines[i] as string).replace(/^\s*\d+\.\s+/, "");
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInlineContent(itemText) }],
        });
        i++;
      }
      content.push({ type: "orderedList", content: items });
      continue;
    }

    // Blockquote: > text
    if (line !== undefined && /^>\s*/.test(line)) {
      const quoteBlocks: AdfBlockNode[] = [];
      while (i < lines.length && lines[i] !== undefined && /^>\s*/.test(lines[i] as string)) {
        const quoteText = (lines[i] as string).replace(/^>\s*/, "");
        if (quoteText) {
          quoteBlocks.push({ type: "paragraph", content: parseInlineContent(quoteText) });
        }
        i++;
      }
      if (quoteBlocks.length > 0) {
        content.push({ type: "blockquote", content: quoteBlocks });
      }
      continue;
    }

    // Empty line — skip
    if (line !== undefined && line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    if (line !== undefined) {
      const paraLines: string[] = [];
      while (
        i < lines.length &&
        lines[i] !== undefined &&
        (lines[i] as string).trim() !== "" &&
        !/^(#{1,6}\s|[-*]\s+|\d+\.\s+|>\s*|```|(\s*[-*_]\s*){3,}$)/.test(lines[i] as string)
      ) {
        paraLines.push(lines[i] as string);
        i++;
      }
      if (paraLines.length > 0) {
        const paraText = paraLines.join("\n");
        content.push({ type: "paragraph", content: parseInlineContent(paraText) });
      }
      continue;
    }

    i++;
  }

  // Ensure we have at least one content node (Jira rejects empty docs)
  if (content.length === 0) {
    content.push({ type: "paragraph", content: [{ type: "text", text: " " }] });
  }

  return {
    type: "doc",
    version: 1,
    content,
  };
}
