// Tests output transforms applied after Markdown compilation: table wrapping,
// syntax highlighting, inert code blocks, and visible footnotes.

import { describe, expect, it } from "vitest";
import { compileMarkdown } from "./compile-markdown.js";
import { serializeHtml } from "../serialize-html.js";

const compileAndSerialize = (markdown: string): string => {
  const { root } = compileMarkdown({ markdown });
  return serializeHtml({ root });
};

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

  it("should not rewrap a component grid that ships its own scroll container", () => {
    const bodyHtml = compileAndSerialize(
      '<DatabaseTableSchema name="users">\n\n```dbml\nid bigint [pk]\n```\n\n</DatabaseTableSchema>\n',
    );
    const wrappers = bodyHtml.match(/data-table-scroll-container/g) ?? [];
    expect(wrappers).toHaveLength(1);
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
    const bodyHtml = compileAndSerialize("```\nSELECT id FROM users;\n```\n");
    expect(bodyHtml).toContain("<code>SELECT id FROM users;\n</code></pre>");
    expect(bodyHtml).not.toContain('class="hljs"');
  });

  it("should preserve a block as plain code when its declared language is unknown", () => {
    const bodyHtml = compileAndSerialize(
      "```big-plan-example\nplain & safe\n```\n",
    );
    expect(bodyHtml).toContain(
      '<code class="hljs language-big-plan-example">plain &#x26; safe\n</code></pre>',
    );
  });

  it("should render block code without script-dependent controls", () => {
    const bodyHtml = compileAndSerialize(
      "```sql\nSELECT 1;\n```\n\n```\nplain block\n```\n",
    );
    expect(bodyHtml.match(/<pre>/g)).toHaveLength(2);
    expect(bodyHtml).not.toContain("<button");
    expect(bodyHtml).not.toContain("data-copy-code");
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
