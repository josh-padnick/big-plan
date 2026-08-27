// Covers the portable document serializer rules component renderers share.

import type { Root } from "hast";
import { describe, expect, it } from "vitest";
import {
  markdownFence,
  markdownFromHast,
  markdownTable,
  MarkdownExportRejected,
} from "./markdown-export.js";

describe("Markdown export primitives", () => {
  it("should size a code fence beyond every backtick run", () => {
    expect(markdownFence({ source: "before ``` after", language: "ts" })).toBe(
      "````ts\nbefore ``` after\n````",
    );
  });

  it("should escape table separators and flatten cell line breaks", () => {
    expect(
      markdownTable({
        headers: ["Name", "Meaning"],
        rows: [["left | right", "one\ntwo"]],
      }),
    ).toContain("| left \\| right | one two |");
  });

  it("should preserve nested prose, links, images, and heading offsets", () => {
    const nodes: Root["children"] = [
      {
        type: "element",
        tagName: "h2",
        properties: {},
        children: [{ type: "text", value: "Details" }],
      },
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          { type: "text", value: "Read " },
          {
            type: "element",
            tagName: "a",
            properties: { href: "https://example.com" },
            children: [{ type: "text", value: "the guide" }],
          },
          { type: "text", value: " and inspect " },
          {
            type: "element",
            tagName: "img",
            properties: { src: "diagram.png", alt: "Release flow" },
            children: [],
          },
          { type: "text", value: "." },
        ],
      },
    ];

    expect(markdownFromHast(nodes, { headingOffset: 1 })).toBe(
      "### Details\n\nRead [the guide](https://example.com) and inspect ![Release flow](diagram.png).",
    );
  });

  it("should refuse an image whose meaning cannot survive as text", () => {
    const nodes: Root["children"] = [
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "img",
            properties: { src: "diagram.png" },
            children: [],
          },
        ],
      },
    ];

    expect(() => markdownFromHast(nodes)).toThrow(MarkdownExportRejected);
  });

  it("should preserve footnotes as portable definitions", () => {
    const nodes: Root["children"] = [
      {
        type: "element",
        tagName: "section",
        properties: { dataFootnotes: true },
        children: [
          {
            type: "element",
            tagName: "ol",
            properties: {},
            children: [
              {
                type: "element",
                tagName: "li",
                properties: { id: "user-content-fn-1" },
                children: [
                  {
                    type: "element",
                    tagName: "p",
                    properties: {},
                    children: [{ type: "text", value: "Footnote detail." }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    expect(markdownFromHast(nodes)).toBe("[^1]: Footnote detail.");
  });

  it("should keep escaped block markers as text instead of new structure", () => {
    const nodes: Root["children"] = [
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [
          { type: "text", value: "# label\n- not a list\n1. not ordered" },
        ],
      },
    ];

    expect(markdownFromHast(nodes)).toBe(
      "\\# label\n\\- not a list\n\\1. not ordered",
    );
  });
});
