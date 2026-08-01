// Tests MDX plan-format validation, normalized diagnostics, and compatible
// GFM input through the Markdown compiler's public interface.

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
        message: "Inline JSX is not supported; components must be flow-level",
      },
    ]);
  });

  it("should reject an unknown component when it is absent from the registry", () => {
    expect(diagnosticsFor("<Unknown />\n")).toEqual([
      { line: 1, column: 1, message: 'Unknown component "Unknown"' },
    ]);
  });

  it("should reject an inherited object property when used as a component", () => {
    expect(diagnosticsFor("<toString />\n")).toEqual([
      { line: 1, column: 1, message: 'Unknown component "toString"' },
    ]);
  });

  it("should reject a spread attribute when a component uses one", () => {
    expect(diagnosticsFor("<Unknown {...props} />\n")).toEqual([
      { line: 1, column: 1, message: 'Unknown component "Unknown"' },
      { line: 1, column: 10, message: "Spread attributes are not supported" },
    ]);
  });

  it("should reject an expression attribute when a component uses one", () => {
    expect(diagnosticsFor("<Unknown tone={tone} />\n")).toEqual([
      { line: 1, column: 1, message: 'Unknown component "Unknown"' },
      {
        line: 1,
        column: 10,
        message: 'Expression-valued attribute "tone" is not supported',
      },
    ]);
  });

  it("should reject a duplicate attribute when a name repeats", () => {
    expect(diagnosticsFor('<Unknown tone="a" tone="b" />\n')).toEqual([
      { line: 1, column: 1, message: 'Unknown component "Unknown"' },
      { line: 1, column: 19, message: 'Duplicate attribute "tone"' },
    ]);
  });

  it("should accept shorthand attributes at validation when a value is omitted", () => {
    expect(diagnosticsFor("<Unknown flag />\n")).toEqual([
      { line: 1, column: 1, message: 'Unknown component "Unknown"' },
    ]);
  });

  it("should preserve prototype-named attributes for component validation", () => {
    expect(diagnosticsFor('<Callout type="note" __proto__ />\n')).toEqual([
      {
        line: 1,
        column: 1,
        message: 'Unknown attribute "__proto__" on Callout',
      },
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
      { line: 5, column: 1, message: 'Unknown component "Unknown"' },
    ]);
  });

  it("should render MDX-compatible GFM features without changing their HTML", () => {
    expect(
      compileAndSerialize(
        "# Plan\n\nA **safe** [link](https://example.com).\n",
      ),
    ).toBe(
      '<h1 id="plan" data-block-id="document/heading-1" data-block-kind="heading" data-block-label="Plan" data-block-section="Overview">Plan</h1>\n' +
        '<p data-block-id="document/paragraph-1" data-block-kind="paragraph" data-block-label="A safe link." data-block-section="Overview">A <strong>safe</strong> <a href="https://example.com">link</a>.</p>',
    );
  });
});
