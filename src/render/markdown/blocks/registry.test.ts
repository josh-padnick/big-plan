// Tests that scoped block names dispatch only for direct children of the
// declaring global block while preserving their supported Markdown bodies.

import { describe, expect, it } from "vitest";
import {
  compileMarkdown,
  MarkdownDiagnosticsError,
  serializeMarkdown,
} from "../convert.js";
import { createDiagnosticCollector } from "./diagnostics.js";
import { validateBlockAttributes } from "./registry.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 9, column: 12, offset: 100 },
};

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
    expect(
      diagnosticsFor('<Annotation lines="1">\nReview.\n</Annotation>\n'),
    ).toEqual([
      {
        line: 1,
        column: 1,
        message: 'Unknown block "Annotation"',
      },
    ]);
  });

  it("should dispatch a direct child through its declaring parent", () => {
    const { root } = compileMarkdown({
      markdown:
        '<CodeDiff file="src/retry.ts">\n```diff\n@@ -1 +1 @@\n-old\n+new\n```\n\n<Annotation lines="1">\nUse **bounded** retries.\n</Annotation>\n</CodeDiff>\n',
    });
    const html = serializeMarkdown({ root });
    expect(html).toContain('data-annotation-lines="1"');
    expect(html).toContain("Use <strong>bounded</strong> retries.");
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

describe("validateBlockAttributes", () => {
  const validate = (
    schema: Parameters<typeof validateBlockAttributes>[0]["schema"],
    attributes: Readonly<Record<string, string | boolean>>,
  ) => {
    const diagnostics = createDiagnosticCollector();
    const values = validateBlockAttributes({
      block: "Sample",
      attributes,
      position: POSITION,
      diagnostics,
      schema,
    });
    return { values, messages: diagnostics.diagnostics.map((d) => d.message) };
  };

  it("should report a missing required enum with its allowed values", () => {
    const { messages } = validate(
      { tone: { kind: "enum", values: ["calm", "loud"], required: true } },
      {},
    );
    expect(messages).toEqual([
      'Missing required attribute "tone"; expected one of: calm, loud',
    ]);
  });

  it("should report an invalid enum value and return undefined for it", () => {
    const { values, messages } = validate(
      { tone: { kind: "enum", values: ["calm", "loud"], required: true } },
      { tone: "shrill" },
    );
    expect(messages).toEqual([
      'Invalid value for attribute "tone"; expected one of: calm, loud',
    ]);
    expect(values.tone).toBeUndefined();
  });

  it("should return a valid enum value typed to its union", () => {
    const { values, messages } = validate(
      { tone: { kind: "enum", values: ["calm", "loud"], required: true } },
      { tone: "calm" },
    );
    expect(messages).toEqual([]);
    expect(values.tone).toBe("calm");
  });

  it.each(["", "   "])(
    "should reject an empty required non-empty string",
    (value) => {
      const { messages } = validate(
        { file: { kind: "string", required: true, nonEmpty: true } },
        { file: value },
      );
      expect(messages).toEqual(['Attribute "file" must be a non-empty string']);
    },
  );

  it("should report a missing required string", () => {
    const { messages } = validate(
      { file: { kind: "string", required: true } },
      {},
    );
    expect(messages).toEqual([
      'Missing required attribute "file"; expected a string',
    ]);
  });

  it("should reject a shorthand value for a string attribute", () => {
    const { messages } = validate(
      { title: { kind: "string" } },
      { title: true },
    );
    expect(messages).toEqual(['Attribute "title" must be a string']);
  });

  it("should accept a bare shorthand boolean and reject its string form", () => {
    const bare = validate(
      { wide: { kind: "booleanShorthand" } },
      { wide: true },
    );
    expect(bare.messages).toEqual([]);
    expect(bare.values.wide).toBe(true);
    const stringy = validate(
      { wide: { kind: "booleanShorthand" } },
      { wide: "true" },
    );
    expect(stringy.messages).toEqual([
      'Attribute "wide" is a shorthand boolean; use the bare form',
    ]);
  });

  it("should sweep unknown attributes naming the block", () => {
    const { messages } = validate(
      { tone: { kind: "enum", values: ["calm"], required: true } },
      { tone: "calm", compact: true },
    );
    expect(messages).toEqual(['Unknown attribute "compact" on Sample']);
  });
});
