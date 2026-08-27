// Covers the portable document serializer rules component renderers share.

import type { Element, Root } from "hast";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import {
  markdownBullet,
  markdownFence,
  markdownFromHast,
  markdownTable,
  MarkdownExportRejected,
} from "./markdown-export.js";

// The export is Markdown a reader opens somewhere else, so these assertions
// read the rendered result rather than the escape spelling that produced it.
const readerHtml = (markdown: string): string =>
  String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeStringify)
      .processSync(markdown),
  );

const cell = (tagName: "th" | "td", value: string): Element => ({
  type: "element",
  tagName,
  properties: {},
  children: [{ type: "text", value }],
});

const authoredTable = (
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): Element => ({
  type: "element",
  tagName: "table",
  properties: {},
  children: [
    {
      type: "element",
      tagName: "tr",
      properties: {},
      children: headers.map((value) => cell("th", value)),
    },
    ...rows.map((row): Element => ({
      type: "element",
      tagName: "tr",
      properties: {},
      children: row.map((value) => cell("td", value)),
    })),
  ],
});

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
      "\\# label\n\\- not a list\n1\\. not ordered",
    );
    const html = readerHtml(markdownFromHast(nodes));
    expect(html).toContain("# label");
    expect(html).toContain("- not a list");
    expect(html).toContain("1. not ordered");
    expect(html).not.toContain("\\");
    expect(html).not.toContain("<ol");
    expect(html).not.toContain("<ul");
  });

  it("should escape an authored table cell exactly once", () => {
    const markdown = markdownFromHast([
      authoredTable(
        ["Setting"],
        [["plan_id"], ["C:\\tmp"], ["a * b"], ["left | right"]],
      ),
    ]);

    const html = readerHtml(markdown);
    expect(html).toContain("<td>plan_id</td>");
    expect(html).toContain("<td>C:\\tmp</td>");
    expect(html).toContain("<td>a * b</td>");
    expect(html).toContain("<td>left | right</td>");
  });

  it("should keep inline markup a table cell carries", () => {
    const markdown = markdownFromHast([
      {
        type: "element",
        tagName: "table",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "tr",
            properties: {},
            children: [cell("th", "Field")],
          },
          {
            type: "element",
            tagName: "tr",
            properties: {},
            children: [
              {
                type: "element",
                tagName: "td",
                properties: {},
                children: [
                  {
                    type: "element",
                    tagName: "strong",
                    properties: {},
                    children: [{ type: "text", value: "plan_id" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);

    expect(readerHtml(markdown)).toContain("<td><strong>plan_id</strong></td>");
  });

  it("should keep a multi-block bullet body inside its list item", () => {
    const html = readerHtml(
      [
        markdownBullet("**Integrity:** Excellent\n\nSecond paragraph."),
        markdownBullet("**Local setup:** Good"),
      ].join("\n"),
    );

    expect(html).toContain("<p>Second paragraph.</p>");
    expect(html.slice(0, html.indexOf("Second paragraph."))).toContain("<li>");
    expect(html.slice(html.indexOf("Second paragraph."))).toContain("</li>");
    expect(html.match(/<ul>/gu)).toHaveLength(1);
  });
});
