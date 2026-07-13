// Tests CodeDiff's attribute and child diagnostics plus its dual-view HAST
// shape, header metadata, normalized fence copy source, accessible line
// semantics, line gutters, and decorator-safe element choices.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../diagnostics.js";
import { renderCodeDiff } from "./code-diff.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 9, column: 12, offset: 100 },
};

const fence = ({ language = "diff", source = "@@ -1 +1 @@\n-old\n+new\n" } = {}): Element => ({
  type: "element",
  tagName: "pre",
  properties: {},
  position: {
    start: { line: 4, column: 1, offset: 30 },
    end: { line: 8, column: 4, offset: 80 },
  },
  children: [{
    type: "element",
    tagName: "code",
    properties: { className: [`language-${language}`] },
    position: {
      start: { line: 4, column: 1, offset: 30 },
      end: { line: 8, column: 4, offset: 80 },
    },
    children: [{ type: "text", value: source }],
  }],
});

const render = ({
  attributes = { file: "src/retry.ts" },
  children = [fence()],
}: {
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const element = renderCodeDiff({
    attributes,
    children,
    position: POSITION,
    diagnostics,
  });
  return { element, diagnostics: diagnostics.diagnostics };
};

describe("renderCodeDiff", () => {
  it("should diagnose a missing file attribute", () => {
    expect(render({ attributes: {} }).diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message: 'Missing required attribute "file"; expected a string',
    });
  });

  it.each(["", "   "])("should diagnose an empty file attribute", (file) => {
    expect(render({ attributes: { file } }).diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message: 'Attribute "file" must be a non-empty string',
    });
  });

  it("should diagnose a shorthand file and string-valued showLineNumbers", () => {
    expect(render({ attributes: { file: true, showLineNumbers: "true" } }).diagnostics).toEqual([
      { line: 3, column: 1, message: 'Attribute "file" must be a string' },
      {
        line: 3,
        column: 1,
        message: 'Attribute "showLineNumbers" is a shorthand boolean; use the bare form',
      },
    ]);
  });

  it("should diagnose an unknown attribute", () => {
    expect(render({ attributes: { file: "x", compact: true } }).diagnostics).toEqual([
      { line: 3, column: 1, message: 'Unknown attribute "compact" on CodeDiff' },
    ]);
  });

  it("should omit the header stats by default", () => {
    const { element, diagnostics } = render();
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(element)).not.toContain("code-diff-stats");
  });

  it("should render the header stats when showLineCounts is set", () => {
    const { element, diagnostics } = render({
      attributes: { file: "src/retry.ts", showLineCounts: true },
    });
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(element)).toContain("code-diff-stats");
  });

  it("should diagnose a string-valued showLineCounts", () => {
    expect(
      render({ attributes: { file: "x", showLineCounts: "true" } }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Attribute "showLineCounts" is a shorthand boolean; use the bare form',
      },
    ]);
  });

  it("should diagnose a wrong-language child", () => {
    expect(render({ children: [fence({ language: "ts" })] }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "CodeDiff expects exactly one fenced code block with language diff and no other content",
      },
    ]);
  });

  it("should diagnose a missing fence", () => {
    expect(render({ children: [] }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "CodeDiff expects exactly one fenced code block with language diff and no other content",
      },
    ]);
  });

  it("should diagnose multiple fences", () => {
    expect(render({ children: [fence(), fence()] }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "CodeDiff expects exactly one fenced code block with language diff and no other content",
      },
    ]);
  });

  it("should diagnose extra markdown children", () => {
    expect(render({
      children: [fence(), { type: "element", tagName: "p", properties: {}, children: [] }],
    }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "CodeDiff expects exactly one fenced code block with language diff and no other content",
      },
    ]);
  });

  it("should diagnose showLineNumbers when a headerless diff cannot supply numbers", () => {
    expect(render({
      attributes: { file: "x", showLineNumbers: true },
      children: [fence({ source: "-old\n+new\n" })],
    }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "CodeDiff cannot show line numbers without an @@ hunk header",
      },
    ]);
  });

  it("should report malformed lines at their document and fence-relative positions", () => {
    expect(render({ children: [fence({ source: "@@ -1 +1 @@\nbad\n" })] }).diagnostics).toEqual([
      {
        line: 6,
        column: 1,
        message: "Invalid diff line 2: Expected a diff line beginning with space, +, or -",
      },
    ]);
  });

  it("should render both numbered views and preserve the normalized fence source", () => {
    const source = "@@ -1 +1 @@\n-old\n+new\n";
    const { element, diagnostics } = render({
      attributes: { file: "src/retry.ts", showLineNumbers: true },
      children: [fence({ source })],
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("figure");
    expect(element.properties["data-diff-view"]).toBe("unified");
    expect(rendered).toContain('"data-diff-content":"unified"');
    expect(rendered).toContain('"data-diff-content":"split"');
    expect(rendered).toContain('"data-diff-line":"remove"');
    expect(rendered).toContain('"data-diff-line":"add"');
    expect(rendered).toContain('"value":"Removed line: "');
    expect(rendered).toContain('"value":"Added line: "');
    expect(rendered).toContain('"data-diff-number":"old"');
    expect(rendered).toContain('"data-diff-number":"new"');
    expect(rendered).toContain('"tagName":"textarea"');
    expect(rendered).toContain(`"value":${JSON.stringify(source)}`);
    expect(rendered).not.toContain('"tagName":"pre"');
    expect(rendered).not.toContain('"tagName":"code"');
  });
});
