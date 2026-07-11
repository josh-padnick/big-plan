// Unit tests for structured markdown compilation, final serialization,
// section extraction edge cases, and the table scroll-container transform.

import { describe, expect, it } from "vitest";
import { CODE_BLOCK_SELECTOR } from "./code-block/decorate-code-blocks.js";
import {
  compileMarkdown,
  MarkdownDiagnosticsError,
  serializeMarkdown,
} from "./convert.js";

const compileAndSerialize = (markdown: string): string => {
  const { root } = compileMarkdown({ markdown });
  return serializeMarkdown({ root });
};

// Extracts the typed failure while preserving unexpected exceptions.
const diagnosticsFor = (markdown: string) => {
  try {
    compileMarkdown({ markdown });
  } catch (error: unknown) {
    if (error instanceof MarkdownDiagnosticsError) {
      return error.diagnostics;
    }
    throw error;
  }
  throw new Error("Expected markdown compilation to fail");
};

describe("compileMarkdown static MDX validation", () => {
  it("should reject ESM when a document contains an export", () => {
    expect(diagnosticsFor("export const plan = true\n")).toEqual([
      {
        line: 1,
        column: 1,
        message: "ESM import/export statements are not supported",
      },
    ]);
  });

  it("should reject a flow expression when an expression occupies a block", () => {
    expect(diagnosticsFor("intro\n\n{plan}\n")).toEqual([
      { line: 3, column: 1, message: "Flow expressions are not supported" },
    ]);
  });

  it("should reject a text expression when an expression is inline", () => {
    expect(diagnosticsFor("Copy {plan}\n")).toEqual([
      { line: 1, column: 6, message: "Text expressions are not supported" },
    ]);
  });

  it("should reject inline JSX when an element occurs inside text", () => {
    expect(diagnosticsFor("Before <Badge /> after\n")).toEqual([
      {
        line: 1,
        column: 8,
        message: "Inline JSX is not supported; blocks must be flow-level",
      },
    ]);
  });

  it("should reject an unknown component when it is absent from the registry", () => {
    expect(diagnosticsFor("<Unknown />\n")).toEqual([
      { line: 1, column: 1, message: "Unknown block \"Unknown\"" },
    ]);
  });

  it("should reject a spread attribute when a block uses one", () => {
    expect(diagnosticsFor("<Unknown {...props} />\n")).toEqual([
      { line: 1, column: 1, message: "Unknown block \"Unknown\"" },
      { line: 1, column: 10, message: "Spread attributes are not supported" },
    ]);
  });

  it("should reject an expression attribute when a block uses one", () => {
    expect(diagnosticsFor("<Unknown tone={tone} />\n")).toEqual([
      { line: 1, column: 1, message: "Unknown block \"Unknown\"" },
      {
        line: 1,
        column: 10,
        message: "Expression-valued attribute \"tone\" is not supported",
      },
    ]);
  });

  it("should reject a duplicate attribute when a name repeats", () => {
    expect(diagnosticsFor('<Unknown tone="a" tone="b" />\n')).toEqual([
      { line: 1, column: 1, message: "Unknown block \"Unknown\"" },
      { line: 1, column: 19, message: "Duplicate attribute \"tone\"" },
    ]);
  });

  it("should accept shorthand attributes at validation when a value is omitted", () => {
    expect(diagnosticsFor("<Unknown flag />\n")).toEqual([
      { line: 1, column: 1, message: "Unknown block \"Unknown\"" },
    ]);
  });

  it("should normalize a parse failure with its line and column", () => {
    expect(diagnosticsFor("# Plan\n\n<Callout>\n")).toEqual([
      {
        line: 3,
        column: 1,
        message: "Expected a closing tag for `<Callout>` (3:1-3:10)",
      },
    ]);
  });

  it("should collect every diagnostic when invalid constructs coexist", () => {
    expect(
      diagnosticsFor("export const plan = true\n\n{plan}\n\n<Unknown />\n"),
    ).toEqual([
      {
        line: 1,
        column: 1,
        message: "ESM import/export statements are not supported",
      },
      { line: 3, column: 1, message: "Flow expressions are not supported" },
      { line: 5, column: 1, message: "Unknown block \"Unknown\"" },
    ]);
  });

  it("should render byte-identical HTML when a document uses only plain GFM", () => {
    expect(compileAndSerialize("# Plan\n\nA **safe** [link](https://example.com).\n"))
      .toBe(
        '<h1 id="plan">Plan</h1>\n<p>A <strong>safe</strong> <a href="https://example.com">link</a>.</p>',
      );
  });
});

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
    expect(bodyHtml).toContain("<code>SELECT id FROM users;\n</code></pre>");
    expect(bodyHtml).not.toContain("class=\"hljs\"");
  });

  it("should preserve a block as plain code when its declared language is unknown", () => {
    const bodyHtml = compileAndSerialize(
      "```big-plan-example\nplain & safe\n```\n",
    );
    expect(bodyHtml).toContain(
      '<code class="hljs language-big-plan-example">plain &#x26; safe\n</code></pre>',
    );
  });

  it("should add a shadcn copy button to every block code element", () => {
    const bodyHtml = compileAndSerialize(
      "```sql\nSELECT 1;\n```\n\n```\nplain block\n```\n",
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

describe("compileMarkdown Callout blocks", () => {
  it("should run downstream transforms when a callout contains fenced code", () => {
    const bodyHtml = compileAndSerialize(
      '<Callout type="warning" title="Review goal">\n### Retry state\n\n- pending\n- failed\n\n```sql\nSELECT id FROM retries;\n```\n</Callout>\n',
    );
    expect(bodyHtml).toContain('<aside data-callout="warning"');
    expect(bodyHtml).toContain('data-lucide="triangle-alert"');
    expect(bodyHtml).toContain("<span");
    expect(bodyHtml).toContain(">Review goal</span>");
    expect(bodyHtml).toContain('<h3 id="retry-state">Retry state</h3>');
    expect(bodyHtml).toContain("<li>pending</li>");
    expect(bodyHtml).toContain('<code class="hljs language-sql">');
    expect(bodyHtml).toContain('<span class="hljs-keyword">SELECT</span>');
    expect(bodyHtml).toContain(CODE_BLOCK_SELECTOR);
    expect(bodyHtml).toContain("data-copy-code");
  });
});

describe("compileMarkdown CodeDiff blocks", () => {
  it("should render both views without highlighting or decorating the consumed fence", () => {
    const bodyHtml = compileAndSerialize(
      '<CodeDiff file="src/retry.ts" lineNumbers>\n```diff\n@@ -1 +1,2 @@\n-old\n+new\n+audit\n```\n</CodeDiff>\n',
    );
    expect(bodyHtml).toContain('data-code-diff="" data-diff-view="unified"');
    expect(bodyHtml).toContain('data-diff-content="unified"');
    expect(bodyHtml).toContain('data-diff-content="split"');
    expect(bodyHtml).toContain('data-diff-number="old"');
    expect(bodyHtml).toContain('data-diff-number="new"');
    expect(bodyHtml).toContain('data-diff-line="remove"');
    expect(bodyHtml).toContain('data-diff-line="add"');
    expect(bodyHtml).toContain('<textarea hidden readonly data-diff-source="">');
    expect(bodyHtml).not.toContain("hljs");
    expect(bodyHtml).not.toContain(CODE_BLOCK_SELECTOR);
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
