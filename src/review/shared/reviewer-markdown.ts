// Owns the bounded, inert Markdown tree for reviewer-authored comments,
// replies, and chat messages. Agent-authored Markdown remains owned by
// message-markdown.ts and intentionally has no review-image nodes.

import type { Nodes, Parent, Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  isReviewImageId,
  reviewImageId,
  type ReviewImageId,
} from "./review-image.js";

const NODE_LIMIT = 500;
const DEPTH_LIMIT = 6;
const URL_LIMIT = 1000;

export type ReviewerMarkdownNode =
  | { readonly type: "text"; readonly value: string }
  | {
      readonly type: "paragraph" | "strong" | "emphasis" | "blockquote";
      readonly children: ReadonlyArray<ReviewerMarkdownNode>;
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
      readonly children: ReadonlyArray<ReviewerMarkdownNode>;
    }
  | { readonly type: "image"; readonly id: ReviewImageId; readonly alt: string }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      readonly children: ReadonlyArray<ReviewerMarkdownNode>;
    }
  | {
      readonly type: "listItem";
      readonly children: ReadonlyArray<ReviewerMarkdownNode>;
    };

class ReviewerMarkdownLimit extends Error {}

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

/** Parses reviewer Markdown into a bounded tree with inert HTML handling. */
export const parseReviewerMarkdown = (
  value: string,
): ReadonlyArray<ReviewerMarkdownNode> => {
  try {
    const root = unified().use(remarkParse).parse(value) as Root;
    let count = 0;
    const convert = (node: Nodes, depth: number): ReviewerMarkdownNode => {
      count += 1;
      if (count > NODE_LIMIT || depth > DEPTH_LIMIT) {
        throw new ReviewerMarkdownLimit();
      }
      const children = (): ReadonlyArray<ReviewerMarkdownNode> =>
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
        case "image": {
          const prefix = "review-image:";
          const candidate = node.url.startsWith(prefix)
            ? node.url.slice(prefix.length)
            : "";
          return isReviewImageId(candidate)
            ? {
                type: "image",
                id: reviewImageId(candidate),
                alt: node.alt ?? "Screenshot",
              }
            : { type: "text", value: node.alt ?? "" };
        }
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
  } catch (error: unknown) {
    if (!(error instanceof ReviewerMarkdownLimit)) throw error;
    return [{ type: "text", value }];
  }
};

const reviewerMarkdownLabel = (node: ReviewerMarkdownNode): string => {
  switch (node.type) {
    case "text":
    case "inlineCode":
    case "code":
      return node.value;
    case "image":
      return node.alt || "Image";
    case "paragraph":
    case "strong":
    case "emphasis":
    case "blockquote":
    case "link":
    case "listItem":
      return node.children.map(reviewerMarkdownLabel).join(" ");
    case "list":
      return node.children.map(reviewerMarkdownLabel).join(" ");
  }
};

/** Returns a short human label without exposing raw reviewer image references. */
export const reviewerMessageLabel = (value: string): string => {
  const label = parseReviewerMarkdown(value)
    .map(reviewerMarkdownLabel)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
  if (label === "") return "Image attachment";
  return label.length > 160 ? `${label.slice(0, 157).trimEnd()}…` : label;
};
