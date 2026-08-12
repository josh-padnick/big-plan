// Owns the bounded, inert message tree used to render agent-authored Markdown
// without ever turning an agent string into executable browser markup.

import type { Nodes, Parent, Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

const NODE_LIMIT = 500;
const DEPTH_LIMIT = 6;
const URL_LIMIT = 1000;

export type MessageNode =
  | { readonly type: "text"; readonly value: string }
  | {
      readonly type: "paragraph" | "strong" | "emphasis" | "blockquote";
      readonly children: ReadonlyArray<MessageNode>;
    }
  | { readonly type: "inlineCode"; readonly value: string }
  | {
      readonly type: "code";
      readonly value: string;
      readonly language?: string;
    }
  | {
      readonly type: "link";
      readonly url: string;
      readonly children: ReadonlyArray<MessageNode>;
    }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      readonly children: ReadonlyArray<MessageNode>;
    }
  | {
      readonly type: "listItem";
      readonly children: ReadonlyArray<MessageNode>;
    };

class MessageTreeLimit extends Error {}

const hasChildren = (node: Nodes): node is Nodes & Parent =>
  "children" in node && Array.isArray(node.children);

const plainText = (node: Nodes): string => {
  if ("value" in node && typeof node.value === "string") return node.value;
  if ("alt" in node && typeof node.alt === "string") return node.alt;
  return hasChildren(node) ? node.children.map(plainText).join("") : "";
};

const allowedUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      value.length <= URL_LIMIT &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
};

const convertTree = (root: Root): ReadonlyArray<MessageNode> => {
  let count = 0;
  const convert = (node: Nodes, depth: number): MessageNode => {
    count += 1;
    if (count > NODE_LIMIT || depth > DEPTH_LIMIT) throw new MessageTreeLimit();
    const children = (): ReadonlyArray<MessageNode> =>
      hasChildren(node)
        ? node.children.map((child) => convert(child, depth + 1))
        : [];
    switch (node.type) {
      case "text":
        return { type: "text", value: node.value };
      case "paragraph":
        return { type: "paragraph", children: children() };
      case "strong":
        return { type: "strong", children: children() };
      case "emphasis":
        return { type: "emphasis", children: children() };
      case "inlineCode":
        return { type: "inlineCode", value: node.value };
      case "code":
        return {
          type: "code",
          value: node.value,
          ...(node.lang === null || node.lang === undefined
            ? {}
            : { language: node.lang.slice(0, 100) }),
        };
      case "link":
        return allowedUrl(node.url)
          ? { type: "link", url: node.url, children: children() }
          : { type: "text", value: plainText(node) };
      case "list":
        return {
          type: "list",
          ordered: node.ordered === true,
          children: children(),
        };
      case "listItem":
        return { type: "listItem", children: children() };
      case "blockquote":
        return { type: "blockquote", children: children() };
      case "heading":
        return {
          type: "paragraph",
          children: [{ type: "strong", children: children() }],
        };
      default:
        return { type: "text", value: plainText(node) };
    }
  };
  return root.children.map((node) => convert(node, 1));
};

/** Parses agent Markdown into the small inert tree the React island renders. */
export const parseMessageMarkdown = (
  value: string,
): ReadonlyArray<MessageNode> => {
  try {
    return convertTree(unified().use(remarkParse).parse(value));
  } catch (error: unknown) {
    if (!(error instanceof MessageTreeLimit)) throw error;
    return [{ type: "text", value }];
  }
};
