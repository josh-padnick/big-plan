// Verifies the Part view standalone: the divider band renders completely
// from its model plus the document outline, and the part tag stays empty
// without a completed outline.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EMPTY_DOCUMENT_OUTLINE } from "../_model/document-outline/document-outline.js";
import type { DocumentOutline } from "../_model/document-outline/document-outline.js";
import type { CompiledPart } from "./compile.js";
import { Part } from "./view.js";

const render = (model: CompiledPart, outline: DocumentOutline): string =>
  renderToStaticMarkup(createElement(Part, { model, outline }));

const OUTLINE: DocumentOutline = {
  parts: [
    { number: 1, title: "Context", id: "part-context" },
    { number: 2, title: "The proposal", id: "part-the-proposal" },
  ],
  sections: [],
};

describe("Part", () => {
  it("should render its number from the outline part matching its anchor", () => {
    const html = render(
      { title: "The proposal", id: "part-the-proposal" },
      OUTLINE,
    );
    expect(html).toContain(">Part 2</span>");
    expect(html).toContain('id="part-the-proposal"');
    expect(html).toContain('data-part-title="The proposal"');
    expect(html).toContain(">The proposal</span>");
  });

  it("should leave the part tag empty when no completed outline surrounds it", () => {
    const html = render(
      { title: "Context", id: "part-context" },
      EMPTY_DOCUMENT_OUTLINE,
    );
    expect(html).toMatch(/<span data-part-number[^>]*><\/span>/);
  });

  it("should leave the part tag empty when the divider has no anchor", () => {
    const html = render({ title: "Context" }, OUTLINE);
    expect(html).toMatch(/<span data-part-number[^>]*><\/span>/);
  });
});
