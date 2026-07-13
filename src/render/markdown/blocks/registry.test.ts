// Tests that scoped block names dispatch only for direct children of the
// declaring global block while retaining ordinary recursion for their bodies.

import { describe, expect, it } from "vitest";
import {
  compileMarkdown,
  MarkdownDiagnosticsError,
  serializeMarkdown,
} from "../convert.js";

// Extracts typed author diagnostics while preserving renderer defects.
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

describe("scoped child dispatch", () => {
  it("should leave a top-level scoped name unknown", () => {
    expect(diagnosticsFor(
      '<Annotation lines="1">\nReview.\n</Annotation>\n',
    )).toEqual([{
      line: 1,
      column: 1,
      message: 'Unknown block "Annotation"',
    }]);
  });

  it("should dispatch a direct child through its declaring parent", () => {
    const { root } = compileMarkdown({
      markdown:
        '<CodeDiff file="src/retry.ts">\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\n\n<Annotation lines="1">\nUse **bounded** retries.\n\n<Callout type="note">\nKeep the nested block.\n</Callout>\n</Annotation>\n</CodeDiff>\n',
    });
    const html = serializeMarkdown({ root });
    expect(html).toContain('data-annotation-lines="1"');
    expect(html).toContain("Use <strong>bounded</strong> retries.");
    expect(html).toContain('data-callout="note"');
  });

  it("should not dispatch a scoped name nested below a direct child", () => {
    const diagnostics = diagnosticsFor(
      '<CodeDiff file="src/retry.ts">\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\n\n<Callout type="note">\n<Annotation lines="1">\nReview.\n</Annotation>\n</Callout>\n</CodeDiff>\n',
    );
    expect(diagnostics).toContainEqual({
      line: 9,
      column: 1,
      message: 'Unknown block "Annotation"',
    });
  });

  it("should centrally validate attribute forms on a dispatched scoped child", () => {
    const diagnostics = diagnosticsFor(
      '<CodeDiff file="src/retry.ts">\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\n\n<Annotation lines="1" lines="2" side={side} {...props}>\nReview.\n</Annotation>\n</CodeDiff>\n',
    );
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Duplicate attribute "lines"',
      'Expression-valued attribute "side" is not supported',
      "Spread attributes are not supported",
    ]);
  });
});
