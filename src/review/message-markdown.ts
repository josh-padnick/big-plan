// Owns the bounded, inert message tree used to carry agent-authored Markdown
// into the review document without ever turning an agent string into HTML.

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

/** Parses agent Markdown into the small inert tree the browser understands. */
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

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Re-validates a serialized message tree at the browser boundary. */
export const validateMessageNodes = (
  value: unknown,
): ReadonlyArray<MessageNode> => {
  if (!Array.isArray(value)) throw new Error("Message nodes must be a list");
  let count = 0;
  const validate = (entry: unknown, depth: number): MessageNode => {
    count += 1;
    if (count > NODE_LIMIT || depth > DEPTH_LIMIT || !isRecord(entry)) {
      throw new Error("Message nodes exceed their safe bounds");
    }
    const stringValue = (): string => {
      if (typeof entry.value !== "string") {
        throw new Error("A message node value must be text");
      }
      return entry.value;
    };
    const children = (): ReadonlyArray<MessageNode> => {
      if (!Array.isArray(entry.children)) {
        throw new Error("A message node must contain children");
      }
      return entry.children.map((child) => validate(child, depth + 1));
    };
    switch (entry.type) {
      case "text":
        return { type: "text", value: stringValue() };
      case "paragraph":
      case "strong":
      case "emphasis":
      case "blockquote":
      case "listItem":
        return { type: entry.type, children: children() };
      case "inlineCode":
        return { type: "inlineCode", value: stringValue() };
      case "code":
        return {
          type: "code",
          value: stringValue(),
          ...(typeof entry.language === "string"
            ? { language: entry.language.slice(0, 100) }
            : {}),
        };
      case "link":
        if (typeof entry.url !== "string" || !allowedUrl(entry.url)) {
          throw new Error("A message link must use http or https");
        }
        return { type: "link", url: entry.url, children: children() };
      case "list":
        if (typeof entry.ordered !== "boolean") {
          throw new Error("A message list must declare its order");
        }
        return {
          type: "list",
          ordered: entry.ordered,
          children: children(),
        };
      default:
        throw new Error("Unsupported message node");
    }
  };
  return value.map((entry) => validate(entry, 1));
};
