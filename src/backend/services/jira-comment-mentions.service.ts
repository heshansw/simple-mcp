import type {
  JiraAdfDocument,
  JiraMentionInput,
  JiraResolvedUser,
} from "@shared/schemas/jira.schema.js";
import {
  err,
  ok,
  validationError,
  type DomainError,
  type Result,
} from "@shared/result.js";

type JiraMentionNode = {
  readonly type: "mention";
  readonly attrs: {
    readonly id: string;
    readonly text: string;
  };
};

type JiraTextNode = {
  readonly type: "text";
  readonly text: string;
  readonly marks?: readonly unknown[];
};

type JiraAdfNode = {
  readonly type?: unknown;
  readonly text?: unknown;
  readonly content?: readonly unknown[];
  readonly [key: string]: unknown;
};

type ResolvedMention = JiraMentionInput & {
  readonly user: JiraResolvedUser;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextNode(value: unknown): value is JiraTextNode {
  return isRecord(value)
    && value.type === "text"
    && typeof value.text === "string";
}

function isNodeWithContent(value: unknown): value is JiraAdfNode & { content: readonly unknown[] } {
  return isRecord(value) && Array.isArray(value.content);
}

function createMentionNode(user: JiraResolvedUser): JiraMentionNode {
  return {
    type: "mention",
    attrs: {
      id: user.accountId,
      text: `@${user.displayName}`,
    },
  };
}

function splitTextNodeByMentions(
  node: JiraTextNode,
  mentions: readonly ResolvedMention[]
): { readonly nodes: Array<JiraTextNode | JiraMentionNode>; readonly matched: Set<string> } {
  if (mentions.length === 0) {
    return { nodes: [node], matched: new Set<string>() };
  }

  const sortedMentions = [...mentions].sort(
    (left, right) => right.placeholder.length - left.placeholder.length
  );
  const nodes: Array<JiraTextNode | JiraMentionNode> = [];
  const matched = new Set<string>();
  let remainingText = node.text;

  while (remainingText.length > 0) {
    let matchedMention: ResolvedMention | undefined;
    let matchedIndex = -1;

    for (const mention of sortedMentions) {
      const index = remainingText.indexOf(mention.placeholder);
      if (index === -1) {
        continue;
      }

      if (matchedIndex === -1 || index < matchedIndex) {
        matchedIndex = index;
        matchedMention = mention;
      }
    }

    if (matchedMention === undefined || matchedIndex === -1) {
      nodes.push({
        type: "text",
        text: remainingText,
        ...(node.marks !== undefined ? { marks: node.marks } : {}),
      });
      break;
    }

    if (matchedIndex > 0) {
      nodes.push({
        type: "text",
        text: remainingText.slice(0, matchedIndex),
        ...(node.marks !== undefined ? { marks: node.marks } : {}),
      });
    }

    nodes.push(createMentionNode(matchedMention.user));
    matched.add(matchedMention.placeholder);
    remainingText = remainingText.slice(matchedIndex + matchedMention.placeholder.length);
  }

  return { nodes, matched };
}

function transformContentArray(
  content: readonly unknown[],
  mentions: readonly ResolvedMention[]
): { readonly content: unknown[]; readonly matched: Set<string> } {
  const matched = new Set<string>();
  const transformed = content.flatMap((item) => {
    if (isTextNode(item)) {
      const splitResult = splitTextNodeByMentions(item, mentions);
      splitResult.matched.forEach((placeholder) => matched.add(placeholder));
      return splitResult.nodes;
    }

    if (isNodeWithContent(item)) {
      const nestedResult = transformContentArray(item.content, mentions);
      nestedResult.matched.forEach((placeholder) => matched.add(placeholder));
      return [{
        ...item,
        content: nestedResult.content,
      }];
    }

    return [item];
  });

  return { content: transformed, matched };
}

export function applyJiraCommentMentions(
  document: JiraAdfDocument,
  mentions: readonly ResolvedMention[]
): Result<JiraAdfDocument, DomainError> {
  if (mentions.length === 0) {
    return ok(document);
  }

  const duplicatePlaceholder = mentions.find(
    (mention, index) => mentions.findIndex((candidate) => candidate.placeholder === mention.placeholder) !== index
  );

  if (duplicatePlaceholder) {
    return err(validationError(`Duplicate mention placeholder: ${duplicatePlaceholder.placeholder}`));
  }

  const transformed = transformContentArray(document.content, mentions);
  for (const mention of mentions) {
    if (!transformed.matched.has(mention.placeholder)) {
      return err(
        validationError(`Mention placeholder not found in comment body: ${mention.placeholder}`)
      );
    }
  }

  return ok({
    ...document,
    content: transformed.content,
  });
}
