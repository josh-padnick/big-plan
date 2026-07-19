// Tests FileTree's attribute and fence diagnostics, fence-relative parser
// positions, change-syntax rejection, and semantic plain hierarchy rendering.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../diagnostics.js";
import { renderFileTree } from "./file-tree.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 9, column: 12, offset: 100 },
};

const fence = ({
  language = "tree",
  source = "src/\n  index.ts - Register the block.\n  helpers.ts\nREADME.md\n",
} = {}): Element => ({
  type: "element",
  tagName: "pre",
  properties: {},
  children: [
    {
      type: "element",
      tagName: "code",
      properties: { className: [`language-${language}`] },
      position: {
        start: { line: 4, column: 1, offset: 30 },
        end: { line: 8, column: 4, offset: 80 },
      },
      children: [{ type: "text", value: source }],
    },
  ],
});

const render = ({
  attributes = {},
  children = [fence()],
}: {
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const element = renderFileTree({
    attributes,
    children,
    scopedChildren: [],
    position: POSITION,
    diagnostics,
  });
  return { element, diagnostics: diagnostics.diagnostics };
};

describe("renderFileTree", () => {
  it("should diagnose a missing fence", () => {
    expect(render({ children: [] }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "FileTree expects exactly one fenced code block with language tree and no other content",
      },
    ]);
  });

  it("should diagnose a wrong-language fence", () => {
    expect(
      render({ children: [fence({ language: "text" })] }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "FileTree expects exactly one fenced code block with language tree and no other content",
      },
    ]);
  });

  it("should diagnose extra meaningful children", () => {
    expect(
      render({
        children: [
          fence(),
          { type: "element", tagName: "p", properties: {}, children: [] },
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "FileTree expects exactly one fenced code block with language tree and no other content",
      },
    ]);
  });

  it("should diagnose an unknown attribute", () => {
    expect(render({ attributes: { compact: true } }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Unknown attribute "compact" on FileTree',
      },
    ]);
  });

  it.each(["", "   "])("should diagnose an empty title", (title) => {
    expect(render({ attributes: { title } }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Attribute "title" must be a non-empty string',
      },
    ]);
  });

  it("should diagnose a shorthand title", () => {
    expect(render({ attributes: { title: true } }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Attribute "title" must be a string',
      },
    ]);
  });

  it("should report invalid tree lines at fence-relative positions", () => {
    expect(
      render({ children: [fence({ source: "src/\n   index.ts\n" })] })
        .diagnostics,
    ).toEqual([
      {
        line: 6,
        column: 1,
        message:
          "Invalid tree line 2: Indentation must use multiples of two spaces",
      },
    ]);
  });

  it("should reject badges and rename arrows with FileTreeDiff guidance", () => {
    const { diagnostics } = render({
      children: [fence({ source: "before.ts -> after.ts [renamed]\n" })],
    });
    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Invalid tree line 1: Change badges are not supported in FileTree; use FileTreeDiff instead",
      "Invalid tree line 1: Rename arrows are not supported in FileTree; use FileTreeDiff instead",
    ]);
  });

  it("should render a titled semantic hierarchy with notes and plain Lucide icons", () => {
    const { element, diagnostics } = render({
      attributes: { title: "Planned changes" },
    });
    const rendered = JSON.stringify(element);
    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("figure");
    expect(element.properties["data-file-tree"]).toBe("");
    expect(rendered).toContain('"tagName":"figcaption"');
    expect(rendered).toContain('"value":"Planned changes"');
    expect(rendered.match(/"tagName":"ul"/gu)).toHaveLength(2);
    expect(rendered).toContain('"data-tree-entry":"directory"');
    expect(rendered).toContain('"data-tree-entry":"file"');
    expect(rendered).toContain('"data-lucide":"folder"');
    expect(rendered).toContain('"data-lucide":"file"');
    expect(rendered).not.toContain('"data-tree-badge"');
    expect(rendered).not.toContain('"file-tree-label"');
    expect(rendered).toContain('"value":"- Register the block."');
    expect(rendered).not.toContain('"tagName":"pre"');
    expect(rendered).not.toContain('"tagName":"code"');
  });

  it("should omit the figcaption when title is absent", () => {
    const { element, diagnostics } = render();
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(element)).not.toContain('"tagName":"figcaption"');
  });
});
