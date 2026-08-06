// Tests CodeSnippet's complete attribute, fence, and Annotation validation
// plus file-absolute gutters, highlighted rows, cards, and raw copy source.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import type { ScopedChild } from "../_authoring/contract.js";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import type { CompiledComponent } from "../_registration/define-component.js";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { CODE_SNIPPET_COMPONENT_DEFINITION } from "./definition.js";

const parseRenderedElement = (compiled: CompiledComponent): Element => {
  const parsed = reactToHast(compiled.presentation());
  if (parsed === undefined) {
    throw new Error("component rendered no element");
  }
  return parsed;
};

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 15, column: 15, offset: 200 },
};

const ANNOTATION_POSITION = {
  start: { line: 9, column: 1, offset: 100 },
  end: { line: 11, column: 14, offset: 160 },
};

const fence = ({
  language = "ts",
  source = "const one = 1;\nconst two = 2;\nconst three = 3;\n",
}: {
  readonly language?: string | null;
  readonly source?: string;
} = {}): Element => ({
  type: "element",
  tagName: "pre",
  properties: {},
  children: [
    {
      type: "element",
      tagName: "code",
      properties:
        language === null ? {} : { className: [`language-${language}`] },
      children: [{ type: "text", value: source }],
    },
  ],
});

const paragraph = (value = "Review this line."): Element => ({
  type: "element",
  tagName: "p",
  properties: {},
  children: [{ type: "text", value }],
});

const annotation = ({
  lines = "43",
  attributes,
  children = [paragraph()],
}: {
  readonly lines?: string | boolean;
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
} = {}): ScopedChild => ({
  name: "Annotation",
  attributes: attributes ?? { lines },
  children,
  position: ANNOTATION_POSITION,
});

const render = ({
  attributes = { file: "src/example.ts" },
  children = [fence()],
  annotations = [],
}: {
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly annotations?: ReadonlyArray<ScopedChild>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const element = parseRenderedElement(
    CODE_SNIPPET_COMPONENT_DEFINITION.compile({
      attributes,
      children,
      scopedChildren: annotations,
      position: POSITION,
      diagnostics,
    }),
  );
  return { element, diagnostics: diagnostics.diagnostics };
};

describe("renderCodeSnippet attributes", () => {
  it("should keep header action icons transparent", () => {
    const rendered = JSON.stringify(render().element);

    expect(rendered).toContain("bg-transparent");
    expect(rendered).toContain("hover:bg-transparent");
  });

  it("should accept an omitted file when another snippet capability is used", () => {
    expect(
      render({ attributes: { showLineNumbers: true } }).diagnostics,
    ).toEqual([]);
  });

  it("should diagnose shorthand and empty file values at the block position", () => {
    expect(render({ attributes: { file: true } }).diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message: 'Attribute "file" must be a string',
    });
    expect(render({ attributes: { file: "  " } }).diagnostics).toContainEqual({
      line: 3,
      column: 1,
      message: 'Attribute "file" must be a non-empty string',
    });
  });

  it.each(["0", "-1", "1.5", "line", "9007199254740992"])(
    "should diagnose invalid positive-integer startLine %s",
    (startLine) => {
      expect(
        render({
          attributes: { file: "x", startLine, showLineNumbers: true },
        }).diagnostics,
      ).toContainEqual({
        line: 3,
        column: 1,
        message: 'Attribute "startLine" must be a positive integer string',
      });
    },
  );

  it("should diagnose shorthand startLine and string-valued showLineNumbers", () => {
    expect(
      render({
        attributes: { file: "x", startLine: true, showLineNumbers: "true" },
      }).diagnostics,
    ).toEqual([
      { line: 3, column: 1, message: 'Attribute "startLine" must be a string' },
      {
        line: 3,
        column: 1,
        message:
          'Attribute "showLineNumbers" is a shorthand boolean; use the bare form',
      },
      {
        line: 3,
        column: 1,
        message: "CodeSnippet cannot use startLine without showLineNumbers",
      },
    ]);
  });

  it("should diagnose startLine when invisible numbering would hide its basis", () => {
    expect(
      render({ attributes: { file: "x", startLine: "42" } }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message: "CodeSnippet cannot use startLine without showLineNumbers",
      },
    ]);
  });

  it("should diagnose unknown attributes at the block position", () => {
    expect(
      render({ attributes: { file: "x", compact: true } }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Unknown attribute "compact" on CodeSnippet',
      },
    ]);
  });

  it("should reject a bare snippet in favor of a plain markdown fence", () => {
    expect(render({ attributes: {} }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "A bare CodeSnippet duplicates a plain markdown fence, which already provides syntax highlighting",
      },
    ]);
  });
});

describe("renderCodeSnippet fence contract", () => {
  it.each([
    { children: [] },
    { children: [fence(), fence()] },
    { children: [fence(), paragraph("extra")] },
    { children: [paragraph("not a fence")] },
  ])(
    "should require exactly one fence and no extra meaningful content",
    ({ children }) => {
      expect(render({ children }).diagnostics).toContainEqual({
        line: 3,
        column: 1,
        message:
          "CodeSnippet expects exactly one fenced code block and zero or more Annotation blocks with no other content",
      });
    },
  );

  it("should accept a fence with no declared language", () => {
    const { element, diagnostics } = render({
      children: [fence({ language: null })],
    });
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(element)).not.toContain("hljs-");
  });
});

describe("renderCodeSnippet annotations", () => {
  it("should diagnose a missing lines attribute and empty body at the annotation position", () => {
    expect(
      render({
        annotations: [annotation({ attributes: {}, children: [] })],
      }).diagnostics,
    ).toEqual([
      {
        line: 9,
        column: 1,
        message:
          'Missing required attribute "lines"; expected a line or strictly ascending inclusive range within 1-3',
      },
      {
        line: 9,
        column: 1,
        message: "Annotation body must not be empty",
      },
    ]);
  });

  it("should diagnose shorthand lines and unknown Annotation attributes", () => {
    expect(
      render({
        annotations: [
          annotation({
            attributes: { lines: true, tone: "quiet" },
          }),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 9,
        column: 1,
        message: 'Attribute "lines" on Annotation must be a string within 1-3',
      },
      {
        line: 9,
        column: 1,
        message: 'Unknown attribute "tone" on Annotation',
      },
    ]);
  });

  it.each(["line", "42-", "41", "45", "44-43", "042", "43-43", "0"])(
    "should diagnose malformed, non-canonical, out-of-range, or non-ascending range %s",
    (lines) => {
      expect(
        render({
          attributes: {
            file: "x",
            startLine: "42",
            showLineNumbers: true,
          },
          annotations: [annotation({ lines })],
        }).diagnostics,
      ).toEqual([
        {
          line: 9,
          column: 1,
          message:
            'Attribute "lines" on Annotation must be a line or strictly ascending inclusive range within 42-44',
        },
      ]);
    },
  );

  it.each(["42", "44", "42-44"])(
    "should accept boundary annotation range %s",
    (lines) => {
      expect(
        render({
          attributes: {
            file: "x",
            startLine: "42",
            showLineNumbers: true,
          },
          annotations: [annotation({ lines })],
        }).diagnostics,
      ).toEqual([]);
    },
  );

  it("should render file-absolute gutters, marked rows, cards, and raw source", () => {
    const source = "const one = 1;\nconst two = 2;\nconst three = 3;\n";
    const { element, diagnostics } = render({
      attributes: {
        file: "src/example.ts",
        startLine: "42",
        showLineNumbers: true,
      },
      children: [fence({ source })],
      annotations: [annotation({ lines: "43-44" })],
    });
    const rendered = JSON.stringify(element);

    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("figure");
    expect(rendered).toContain('"data-snippet-line-number":"42"');
    expect(rendered).toContain('"data-snippet-line-number":"43"');
    expect(rendered).toContain('"data-snippet-line-number":"44"');
    expect(rendered.match(/data-snippet-annotated/gu)).toHaveLength(2);
    expect(rendered).toContain('"data-snippet-annotated":"start"');
    expect(rendered).toContain('"data-snippet-annotated":"end"');
    expect(rendered).toContain('"data-snippet-annotation":"43-44"');
    expect(rendered).toContain('"value":"Lines 43-44"');
    expect(rendered).toContain('"className":["hljs-keyword"]');
    expect(rendered).toContain('"tagName":"textarea"');
    expect(rendered).toContain(`"value":${JSON.stringify(source)}`);
    expect(rendered).not.toContain('"tagName":"pre"');
    expect(rendered).not.toContain('"tagName":"code"');
  });

  it("should always render the line-number gutter markup so maximize can reveal it, even when showLineNumbers is unset", () => {
    const source = "const one = 1;\nconst two = 2;\n";
    const { element, diagnostics } = render({
      attributes: { file: "src/example.ts" },
      children: [fence({ source })],
    });
    const rendered = JSON.stringify(element);

    expect(diagnostics).toEqual([]);
    expect(rendered).not.toContain('"data-line-numbers"');
    expect(rendered).toContain('"data-snippet-line-number":"1"');
    expect(rendered).toContain('"data-snippet-line-number":"2"');
    expect(rendered).toContain("grid-cols-[4rem_minmax(max-content,1fr)]");
  });
});
