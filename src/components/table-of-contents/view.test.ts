// Verifies the TableOfContents view standalone: rows render their links,
// slide numbers, and part group headers directly from the document outline,
// and rows beyond the outline keep their placeholder link.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY_DOCUMENT_OUTLINE } from "../_model/document-outline/document-outline.js";
import type {
  DocumentOutline,
  DocumentOutlinePart,
} from "../_model/document-outline/document-outline.js";
import type { CompiledTableOfContents } from "./compile.js";
import { TableOfContents } from "./view.js";

const render = (
  model: CompiledTableOfContents,
  outline: DocumentOutline,
): string =>
  renderToStaticMarkup(createElement(TableOfContents, { model, outline }));

const PART_ONE: DocumentOutlinePart = {
  number: 1,
  title: "Context",
  id: "part-context",
};
const PART_TWO: DocumentOutlinePart = {
  number: 2,
  title: "The proposal",
  id: "part-the-proposal",
};

const OUTLINE: DocumentOutline = {
  parts: [PART_ONE, PART_TWO],
  sections: [
    { number: "1.1", title: "Status quo", id: "status-quo", part: PART_ONE },
    {
      number: "1.2",
      title: "Success looks like",
      id: "success-looks-like",
      part: PART_ONE,
    },
    { number: "2.1", title: "The design", id: "the-design", part: PART_TWO },
  ],
};

const MODEL: CompiledTableOfContents = {
  entries: [
    { section: "Status quo", gist: "Today's state" },
    { section: "Success looks like", gist: "The outcome" },
    { section: "The design", gist: "The mechanism" },
  ],
};

describe("TableOfContents", () => {
  it("should title the overview at slide-title h2 scale", () => {
    const html = render(MODEL, OUTLINE);
    expect(html).toMatch(
      /<h2 class="table-of-contents-title[^"]*">The plan in one look<\/h2>/,
    );
    expect(html).toContain("text-2xl");
    expect(html).not.toMatch(
      /<p class="mb-2 text-\[1\.0625rem\][^"]*">The plan in one look<\/p>/,
    );
  });

  it("should link every row to its outline section in document order", () => {
    const html = render(MODEL, OUTLINE);
    expect(html).toMatch(
      /<a data-table-of-contents-row[^>]*href="#status-quo"/,
    );
    expect(html).toMatch(
      /<a data-table-of-contents-row[^>]*href="#success-looks-like"/,
    );
    expect(html).toMatch(
      /<a data-table-of-contents-row[^>]*href="#the-design"/,
    );
  });

  it("should fill every row's slide number from the outline", () => {
    const html = render(MODEL, OUTLINE);
    expect(html).toMatch(/<span data-table-of-contents-num[^>]*>1\.1<\/span>/);
    expect(html).toMatch(/<span data-table-of-contents-num[^>]*>1\.2<\/span>/);
    expect(html).toMatch(/<span data-table-of-contents-num[^>]*>2\.1<\/span>/);
  });

  it("should render one group header before each part's first row", () => {
    const html = render(MODEL, OUTLINE);
    expect(html.match(/data-table-of-contents-group/g)).toHaveLength(2);
    expect(html).toMatch(
      /<p data-table-of-contents-group[^>]*>\[1\] Context<\/p>/,
    );
    expect(html).toMatch(
      /<p data-table-of-contents-group[^>]*>\[2\] The proposal<\/p>/,
    );
    const header = html.indexOf("[1] Context");
    const firstRow = html.indexOf('href="#status-quo"');
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(firstRow);
  });

  it("should render no group headers when the outline has no parts", () => {
    const html = render(MODEL, {
      parts: [],
      sections: [
        { number: "1", title: "Status quo", id: "status-quo" },
        { number: "2", title: "Success looks like", id: "success-looks-like" },
        { number: "3", title: "The design", id: "the-design" },
      ],
    });
    expect(html).not.toContain("data-table-of-contents-group");
    expect(html).toMatch(/<span data-table-of-contents-num[^>]*>1<\/span>/);
  });

  it("should keep placeholders on rows beyond the outline's sections", () => {
    const html = render(
      {
        entries: [
          { section: "Status quo", gist: "Today's state" },
          { section: "Ghost", gist: "No section exists" },
        ],
      },
      {
        parts: [],
        sections: [{ number: "1", title: "Status quo", id: "status-quo" }],
      },
    );
    expect(html).toMatch(
      /<a data-table-of-contents-row[^>]*href="#status-quo"/,
    );
    expect(html).toMatch(/<a data-table-of-contents-row[^>]*href="#"/);
    expect(html).toMatch(/<span data-table-of-contents-num[^>]*><\/span>/);
  });

  it("should keep every row a placeholder without a completed outline", () => {
    const html = render(MODEL, EMPTY_DOCUMENT_OUTLINE);
    expect(html).not.toContain("data-table-of-contents-group");
    expect(html.match(/href="#"/g)).toHaveLength(3);
  });
});
