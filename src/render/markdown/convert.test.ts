// Unit tests for structured markdown compilation, final serialization,
// section extraction edge cases, and the table scroll-container transform.

import { describe, expect, it } from "vitest";
import { CODE_BLOCK_SELECTOR } from "./code-block/decorate-code-blocks.js";
import {
  compileMarkdown,
  serializeMarkdown,
} from "./convert.js";

const compileAndSerialize = (markdown: string): string => {
  const { root } = compileMarkdown({ markdown });
  return serializeMarkdown({ root });
};

describe("compileMarkdown sections", () => {
  it("should extract level-two headings as TOC sections when the document has h2s", () => {
    const { sections } = compileMarkdown({
      markdown: "# Title\n\n## Background\n\ntext\n\n## Rollout plan\n",
    });
    expect(sections).toEqual([
      { id: "background", text: "Background" },
      { id: "rollout-plan", text: "Rollout plan" },
    ]);
  });

  it("should slug headings containing punctuation when extracting sections", () => {
    const { sections } = compileMarkdown({
      markdown: "## Goals & non-goals (v2)!\n",
    });
    expect(sections).toEqual([
      { id: "goals--non-goals-v2", text: "Goals & non-goals (v2)!" },
    ]);
  });

  it("should keep ids unique when two h2 headings have identical text", () => {
    const { sections } = compileMarkdown({
      markdown: "## Review\n\nfirst\n\n## Review\n\nsecond\n",
    });
    expect(sections).toHaveLength(2);
    const ids = sections.map((section) => section.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toBe("review");
  });

  it("should keep inline formatting text when a heading contains code and emphasis", () => {
    const { sections } = compileMarkdown({
      markdown: "## The `retry` *loop*\n",
    });
    expect(sections).toEqual([
      { id: "the-retry-loop", text: "The retry loop" },
    ]);
  });

  it("should ignore non-h2 headings when building sections", () => {
    const { sections } = compileMarkdown({
      markdown: "# One\n\n### Three\n\n#### Four\n",
    });
    expect(sections).toEqual([]);
  });

  it("should exclude the generated footnotes label when the document uses footnotes", () => {
    const { root, sections } = compileMarkdown({
      markdown: "## Real section\n\nbody[^1]\n\n[^1]: a note\n",
    });
    const bodyHtml = serializeMarkdown({ root });
    expect(bodyHtml).toContain('id="footnote-label"');
    expect(sections).toEqual([{ id: "real-section", text: "Real section" }]);
  });

  it("should return no sections and empty body when the document is empty", () => {
    const { root, sections } = compileMarkdown({ markdown: "" });
    const bodyHtml = serializeMarkdown({ root });
    expect(sections).toEqual([]);
    expect(bodyHtml).toBe("");
  });
});

describe("compileMarkdown tables", () => {
  it("should wrap each table in a scroll container when the document has tables", () => {
    const bodyHtml = compileAndSerialize(
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n| c |\n| - |\n| 3 |\n",
    );
    const wrappers = bodyHtml.match(/data-table-scroll-container/g) ?? [];
    expect(wrappers).toHaveLength(2);
  });

  it("should wrap a table nested inside a blockquote when tables are not top-level", () => {
    const bodyHtml = compileAndSerialize("> | a |\n> | - |\n> | 1 |\n");
    expect(bodyHtml).toContain("data-table-scroll-container");
  });
});

describe("compileMarkdown code highlighting", () => {
  it("should highlight a fenced block when it declares a supported language", () => {
    const bodyHtml = compileAndSerialize(
      "```sql\nSELECT id FROM users WHERE active = true;\n```\n",
    );
    expect(bodyHtml).toContain('<code class="hljs language-sql">');
    expect(bodyHtml).toContain('<span class="hljs-keyword">SELECT</span>');
    expect(bodyHtml).toContain('<span class="hljs-keyword">FROM</span>');
  });

  it("should leave an undeclared code block unhighlighted", () => {
    const bodyHtml = compileAndSerialize(
      "```\nSELECT id FROM users;\n```\n",
    );
    expect(bodyHtml).toContain("<pre><code>SELECT id FROM users;\n</code></pre>");
    expect(bodyHtml).not.toContain("class=\"hljs\"");
  });

  it("should preserve a block as plain code when its declared language is unknown", () => {
    const bodyHtml = compileAndSerialize(
      "```grandplan-example\nplain & safe\n```\n",
    );
    expect(bodyHtml).toContain(
      '<pre><code class="hljs language-grandplan-example">plain &#x26; safe\n</code></pre>',
    );
  });

  it("should add a shadcn copy button to every block code element", () => {
    const bodyHtml = compileAndSerialize(
      "```sql\nSELECT 1;\n```\n\n    plain block\n",
    );
    expect(bodyHtml.match(new RegExp(CODE_BLOCK_SELECTOR, "g"))).toHaveLength(2);
    expect(bodyHtml.match(/data-copy-code/g)).toHaveLength(2);
    expect(bodyHtml).toContain('data-slot="button"');
    expect(bodyHtml).toContain('data-variant="ghost"');
    expect(bodyHtml).toContain('data-size="xs"');
    expect(bodyHtml).toContain('aria-label="Copy code"');
    expect(bodyHtml).toContain('data-lucide="copy"');
    expect(bodyHtml).toContain('data-lucide="check" hidden');
    expect(bodyHtml).toContain('data-copy-message="" hidden>Copied!</span>');
  });
});

describe("compileMarkdown title", () => {
  it("should return the first h1 text when the document has one", () => {
    const { title } = compileMarkdown({
      markdown: "intro\n\n# Payments Plan\n\n## Section\n",
    });
    expect(title).toBe("Payments Plan");
  });

  it("should flatten inline markup when the h1 contains code or emphasis", () => {
    const { title } = compileMarkdown({
      markdown: "# The `retry` *pipeline*\n",
    });
    expect(title).toBe("The retry pipeline");
  });

  it("should return undefined when the document has no h1", () => {
    const { title } = compileMarkdown({ markdown: "## Only sections\n" });
    expect(title).toBeUndefined();
  });

  it("should ignore a # line inside a fenced code block when finding the title", () => {
    const { title } = compileMarkdown({
      markdown: "```sh\n# not a heading\n```\n\n# Real title\n",
    });
    expect(title).toBe("Real title");
  });
});

describe("compileMarkdown footnotes", () => {
  it("should render a visible Footnotes heading when the document has footnotes", () => {
    const bodyHtml = compileAndSerialize("text[^1]\n\n[^1]: the note\n");
    expect(bodyHtml).toContain('class="footnotes-heading"');
    expect(bodyHtml).toContain(">Footnotes</h2>");
    expect(bodyHtml).not.toContain("sr-only");
  });
});
