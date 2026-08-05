// Tests full-pipeline component rendering, nested authoring policies, and
// downstream Markdown transforms through representative components.

import { describe, expect, it } from "vitest";
import {
  compileMarkdown,
  MarkdownDiagnosticsError,
} from "./compile-markdown.js";
import { serializeHtml } from "../serialize-html.js";

const compileAndSerialize = (markdown: string): string => {
  const { root } = compileMarkdown({ markdown });
  return serializeHtml({ root });
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

describe("compileMarkdown Callout components", () => {
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
    expect(bodyHtml).not.toContain("data-copy-code");
  });
});

describe("compileMarkdown CodeDiff components", () => {
  it("should render both views without highlighting or decorating the consumed fence", () => {
    const bodyHtml = compileAndSerialize(
      '<CodeDiff file="src/retry.ts" showLineNumbers showLineCounts>\n```diff\n@@ -1 +1,2 @@\n-old\n+new\n+audit\n```\n\n<Annotation lines="1-2">\nUse the `retry` metric prefix.\n</Annotation>\n\n</CodeDiff>\n',
    );
    expect(bodyHtml).toContain('data-code-diff=""');
    expect(bodyHtml).toContain('data-diff-view="unified"');
    expect(bodyHtml).toContain('data-diff-content="unified"');
    expect(bodyHtml).toContain('data-diff-content="split"');
    expect(bodyHtml).toContain('data-diff-number="old"');
    expect(bodyHtml).toContain('data-diff-number="new"');
    expect(bodyHtml).toContain('data-diff-line="remove"');
    expect(bodyHtml).toContain('data-diff-line="add"');
    expect(bodyHtml).toContain(
      '<span class="sr-only">2 added, 1 removed</span>',
    );
    expect(bodyHtml).toContain(
      '<span class="code-diff-stat-add text-[var(--diff-add-c)]" aria-hidden="true">+2</span>',
    );
    expect(bodyHtml).toContain(
      '<span class="code-diff-stat-remove text-[var(--diff-remove-c)]" aria-hidden="true">-1</span>',
    );
    expect(bodyHtml).toContain(
      '<textarea hidden readonly data-diff-source="">',
    );
    expect(bodyHtml.match(/role="note"/gu)).toHaveLength(2);
    expect(bodyHtml).toContain('aria-label="Lines 1-2"');
    expect(bodyHtml).toContain('data-annotation-lines="1-2"');
    expect(bodyHtml).toContain('data-lucide="message-square"');
    expect(bodyHtml).toContain("Use the <code>retry</code> metric prefix.");
    expect(bodyHtml).not.toContain("hljs");
    expect(bodyHtml).not.toContain("data-copy-code");
  });

  it("should diagnose a top-level Annotation as an unknown component", () => {
    expect(
      diagnosticsFor(
        '<Annotation lines="13">\nReview this line.\n</Annotation>\n',
      ),
    ).toEqual([
      {
        line: 1,
        column: 1,
        message: 'Unknown component "Annotation"',
      },
    ]);
  });

  it.each([1, 2, 3, 4, 5, 6])(
    "should reject a level-%s heading in an Annotation body",
    (level) => {
      const heading = `${"#".repeat(level)} Nested heading`;
      expect(
        diagnosticsFor(
          `<CodeDiff file="src/retry.ts">\n\`\`\`diff\n@@ -1 +1 @@\n-old\n+new\n\`\`\`\n<Annotation lines="1">\n${heading}\n</Annotation>\n</CodeDiff>\n`,
        ),
      ).toEqual([
        {
          line: 8,
          column: 1,
          message: "Annotation bodies cannot contain headings",
        },
      ]);
    },
  );

  it("should reject footnote references and definitions in an Annotation body", () => {
    expect(
      diagnosticsFor(
        '<CodeDiff file="src/retry.ts">\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\n<Annotation lines="1">\nRef[^retry].\n\n[^retry]: Retry note.\n</Annotation>\n</CodeDiff>\n',
      ),
    ).toEqual([
      {
        line: 8,
        column: 4,
        message: "Annotation bodies cannot contain footnote references",
      },
      {
        line: 10,
        column: 1,
        message: "Annotation bodies cannot contain footnote definitions",
      },
    ]);
  });

  it.each([
    ["Callout", '<Callout type="note">\nNested callout.\n</Callout>'],
    [
      "CodeDiff",
      '<CodeDiff file="src/nested.ts">\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\n</CodeDiff>',
    ],
  ])(
    "should reject a %s component in an Annotation body",
    (_name, component) => {
      expect(
        diagnosticsFor(
          `<CodeDiff file="src/retry.ts">\n\`\`\`diff\n@@ -1 +1 @@\n-old\n+new\n\`\`\`\n<Annotation lines="1">\n${component}\n</Annotation>\n</CodeDiff>\n`,
        ),
      ).toEqual([
        {
          line: 8,
          column: 1,
          message: "Annotation bodies cannot contain typed components",
        },
      ]);
    },
  );

  it("should preserve supported rich content in an Annotation body", () => {
    const bodyHtml = compileAndSerialize(
      '<CodeDiff file="src/retry.ts">\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\n<Annotation lines="1">\nReview the `retry` path.\n\n- Keep the fallback\n\n```ts\nretry();\n```\n</Annotation>\n</CodeDiff>\n',
    );
    expect(bodyHtml).toContain("Review the <code>retry</code> path.");
    expect(bodyHtml).toContain("<li>Keep the fallback</li>");
    expect(bodyHtml.match(/<code class="hljs language-ts">/gu)).toHaveLength(2);
    expect(bodyHtml).not.toContain("data-copy-code");
  });

  it("should position malformed diff diagnostics at a nested fence column", () => {
    expect(
      diagnosticsFor(
        '> <CodeDiff file="src/retry.ts">\n>\n> ```diff\n> @@ -1 +1 @@\n> bad\n> ```\n> </CodeDiff>\n',
      ),
    ).toEqual([
      {
        line: 5,
        column: 3,
        message:
          "Invalid diff line 2: Expected a diff line beginning with space, +, or -",
      },
      {
        line: 4,
        column: 3,
        message:
          "Invalid diff line 1: Hunk declares 1 old and 1 new lines but contains 0 old and 0 new lines",
      },
    ]);
  });
});
