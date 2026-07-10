// Unit tests for the markdown-to-HTML conversion: section extraction edge
// cases and the table scroll-container transform.

import { describe, expect, it } from "vitest";
import { convertMarkdown, TABLE_WRAPPER_CLASSES } from "./convert.js";

const TABLE_WRAPPER_OPENING = `<div class="${TABLE_WRAPPER_CLASSES.join(" ")}"><table>`;

describe("convertMarkdown sections", () => {
  it("should extract level-two headings as TOC sections when the document has h2s", () => {
    const { sections } = convertMarkdown({
      markdown: "# Title\n\n## Background\n\ntext\n\n## Rollout plan\n",
    });
    expect(sections).toEqual([
      { id: "background", text: "Background" },
      { id: "rollout-plan", text: "Rollout plan" },
    ]);
  });

  it("should slug headings containing punctuation when extracting sections", () => {
    const { sections } = convertMarkdown({
      markdown: "## Goals & non-goals (v2)!\n",
    });
    expect(sections).toEqual([
      { id: "goals--non-goals-v2", text: "Goals & non-goals (v2)!" },
    ]);
  });

  it("should keep ids unique when two h2 headings have identical text", () => {
    const { sections } = convertMarkdown({
      markdown: "## Review\n\nfirst\n\n## Review\n\nsecond\n",
    });
    expect(sections).toHaveLength(2);
    const ids = sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe("review");
  });

  it("should keep inline formatting text when a heading contains code and emphasis", () => {
    const { sections } = convertMarkdown({
      markdown: "## The `retry` *loop*\n",
    });
    expect(sections).toEqual([
      { id: "the-retry-loop", text: "The retry loop" },
    ]);
  });

  it("should ignore non-h2 headings when building sections", () => {
    const { sections } = convertMarkdown({
      markdown: "# One\n\n### Three\n\n#### Four\n",
    });
    expect(sections).toEqual([]);
  });

  it("should exclude the generated footnotes label when the document uses footnotes", () => {
    const { sections, bodyHtml } = convertMarkdown({
      markdown: "## Real section\n\nbody[^1]\n\n[^1]: a note\n",
    });
    expect(bodyHtml).toContain('id="footnote-label"');
    expect(sections).toEqual([{ id: "real-section", text: "Real section" }]);
  });

  it("should return no sections and empty body when the document is empty", () => {
    const { sections, bodyHtml } = convertMarkdown({ markdown: "" });
    expect(sections).toEqual([]);
    expect(bodyHtml).toBe("");
  });
});

describe("convertMarkdown tables", () => {
  it("should wrap each table in a scroll container when the document has tables", () => {
    const { bodyHtml } = convertMarkdown({
      markdown:
        "| a | b |\n| - | - |\n| 1 | 2 |\n\n| c |\n| - |\n| 3 |\n",
    });
    const wrappers = bodyHtml.split(TABLE_WRAPPER_OPENING).length - 1;
    expect(wrappers).toBe(2);
  });

  it("should wrap a table nested inside a blockquote when tables are not top-level", () => {
    const { bodyHtml } = convertMarkdown({
      markdown: "> | a |\n> | - |\n> | 1 |\n",
    });
    expect(bodyHtml).toContain(TABLE_WRAPPER_OPENING);
  });
});
