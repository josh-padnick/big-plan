// Tests CodeDiff's attribute and child diagnostics plus its dual-view HAST
// shape, scoped Annotation anchoring, header metadata, normalized fence copy
// source, accessible line semantics, line gutters, and decorator-safe elements.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../diagnostics.js";
import type { BlockAttributeValue, ScopedChild } from "../registry.js";
import { renderCodeDiff } from "./code-diff.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 9, column: 12, offset: 100 },
};

const fence = ({
  language = "diff",
  source = "@@ -1 +1 @@\n-old\n+new\n",
  column = 1,
} = {}): Element => ({
  type: "element",
  tagName: "pre",
  properties: {},
  position: {
    start: { line: 4, column, offset: 30 },
    end: { line: 8, column: 4, offset: 80 },
  },
  children: [{
    type: "element",
    tagName: "code",
    properties: { className: [`language-${language}`] },
    position: {
      start: { line: 4, column, offset: 30 },
      end: { line: 8, column: 4, offset: 80 },
    },
    children: [{ type: "text", value: source }],
  }],
});

const annotation = ({
  lines,
  side,
  value = "Review this line.",
  positionLine = 10,
  extraAttributes = {},
}: {
  readonly lines: BlockAttributeValue;
  readonly side?: BlockAttributeValue;
  readonly value?: string;
  readonly positionLine?: number;
  readonly extraAttributes?: Readonly<Record<string, BlockAttributeValue>>;
}): ScopedChild => ({
  name: "Annotation",
  attributes: {
    lines,
    ...(side === undefined ? {} : { side }),
    ...extraAttributes,
  },
  position: {
    start: { line: positionLine, column: 1, offset: 100 },
    end: { line: positionLine + 2, column: 12, offset: 150 },
  },
  children: [{
    type: "element",
    tagName: "p",
    properties: {},
    children: [{ type: "text", value }],
  }],
});

const isElement = (node: ElementContent | undefined): node is Element =>
  node?.type === "element";

const textOf = (element: Element): string => element.children.map((child) =>
  child.type === "text" ? child.value : isElement(child) ? textOf(child) : ""
).join("");

// Finds the rendered container that directly owns a matching descendant.
const parentOfMatchingChild = ({
  element,
  matches,
}: {
  readonly element: Element;
  readonly matches: (candidate: Element) => boolean;
}): Element | undefined => {
  for (const child of element.children) {
    if (isElement(child) && matches(child)) {
      return element;
    }
  }
  for (const child of element.children) {
    if (!isElement(child)) {
      continue;
    }
    const found = parentOfMatchingChild({ element: child, matches });
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

// Finds the first matching element in document order for structural checks.
const findElement = ({
  element,
  matches,
}: {
  readonly element: Element;
  readonly matches: (candidate: Element) => boolean;
}): Element | undefined => {
  if (matches(element)) {
    return element;
  }
  for (const child of element.children) {
    if (!isElement(child)) {
      continue;
    }
    const found = findElement({ element: child, matches });
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
};

const viewFrom = ({
  element,
  view,
}: {
  readonly element: Element;
  readonly view: "unified" | "split";
}): Element => {
  const found = element.children.find((child) =>
    isElement(child) && child.properties["data-diff-content"] === view
  );
  if (found === undefined || !isElement(found)) {
    throw new Error(`Missing ${view} diff view`);
  }
  return found;
};

const render = ({
  attributes = { file: "src/retry.ts" },
  children = [fence()],
  scopedChildren = [],
}: {
  readonly attributes?: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
} = {}) => {
  const diagnostics = createDiagnosticCollector();
  const element = renderCodeDiff({
    attributes,
    children,
    scopedChildren,
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

  it("should diagnose an Annotation when a headerless diff cannot supply an anchor", () => {
    expect(render({
      children: [fence({ source: "-old\n+new\n" })],
      scopedChildren: [annotation({ lines: "1", positionLine: 12 })],
    }).diagnostics).toEqual([{
      line: 12,
      column: 1,
      message: "CodeDiff cannot anchor an Annotation without an @@ hunk header",
    }]);
  });

  it("should diagnose a missing lines attribute", () => {
    const child = annotation({ lines: "1", positionLine: 11 });
    expect(render({
      scopedChildren: [{ ...child, attributes: {} }],
    }).diagnostics).toEqual([{
      line: 11,
      column: 1,
      message:
        'Missing required attribute "lines"; expected a positive-integer string or ascending range',
    }]);
  });

  it.each([true, "", "0", "01", "1-1", "2-1", "1-02", "1.5"])(
    "should diagnose invalid lines form %j",
    (lines) => {
      expect(render({
        scopedChildren: [annotation({ lines, positionLine: 11 })],
      }).diagnostics).toEqual([{
        line: 11,
        column: 1,
        message: 'Attribute "lines" must be a positive-integer string or ascending range',
      }]);
    },
  );

  it.each([true, "both"])("should diagnose invalid side form %j", (side) => {
    expect(render({
      scopedChildren: [annotation({ lines: "1", side, positionLine: 11 })],
    }).diagnostics).toEqual([{
      line: 11,
      column: 1,
      message: 'Invalid value for attribute "side"; expected one of: old, new',
    }]);
  });

  it("should diagnose an unknown Annotation attribute contextually", () => {
    expect(render({
      scopedChildren: [annotation({
        lines: "1",
        positionLine: 11,
        extraAttributes: { tone: "quiet" },
      })],
    }).diagnostics).toEqual([{
      line: 11,
      column: 1,
      message: 'Unknown attribute "tone" on Annotation',
    }]);
  });

  it.each([
    ["old", "11-12"],
    ["new", "12-14"],
  ] as const)("should diagnose missing %s-side lines %s", (side, lines) => {
    expect(render({
      children: [fence({ source: "@@ -12 +12 @@\n-old\n+new\n" })],
      scopedChildren: [annotation({ lines, side, positionLine: 14 })],
    }).diagnostics).toEqual([{
      line: 14,
      column: 1,
      message: `Annotation lines ${lines} do not exist on the ${side} side of the diff`,
    }]);
  });

  it("should report malformed lines at their document and fence-relative positions", () => {
    expect(render({ children: [fence({ source: "@@ -1 +1 @@\nbad\n" })] }).diagnostics).toEqual([
      {
        line: 6,
        column: 1,
        message: "Invalid diff line 2: Expected a diff line beginning with space, +, or -",
      },
      {
        line: 5,
        column: 1,
        message:
          "Invalid diff line 1: Hunk declares 1 old and 1 new lines but contains 0 old and 0 new lines",
      },
    ]);
  });

  it("should preserve the fence column for a nested malformed diff", () => {
    expect(render({
      children: [fence({ source: "@@ -1 +1 @@\nbad\n", column: 5 })],
    }).diagnostics).toEqual([
      {
        line: 6,
        column: 5,
        message: "Invalid diff line 2: Expected a diff line beginning with space, +, or -",
      },
      {
        line: 5,
        column: 5,
        message:
          "Invalid diff line 1: Hunk declares 1 old and 1 new lines but contains 0 old and 0 new lines",
      },
    ]);
  });

  it("should diagnose an unsafe hunk range before anchoring an Annotation", () => {
    expect(render({
      children: [fence({
        source: "@@ -1 +999999999999999999999999999999999999999999 @@\n-old\n+new\n",
      })],
      scopedChildren: [annotation({
        lines: "999999999999999999999999999999999999999999",
      })],
    }).diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          "Invalid diff line 1: Hunk values and line-number ranges must not exceed 9007199254740991",
      },
      {
        line: 10,
        column: 1,
        message:
          "Annotation line 999999999999999999999999999999999999999999 does not exist on the new side of the diff",
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

  it("should render a single-line Annotation after its line in both views", () => {
    const { element, diagnostics } = render({
      attributes: { file: "src/cache.ts", showLineNumbers: true },
      children: [fence({
        source: "@@ -12 +12,2 @@\n-const ttl = 30;\n+const ttl = 60;\n+metrics.increment(\"ttl_change\");\n",
      })],
      scopedChildren: [annotation({
        lines: "13",
        value: "Use the catalog prefix.",
      })],
    });
    expect(diagnostics).toEqual([]);

    const unified = viewFrom({ element, view: "unified" });
    const unifiedTargetIndex = unified.children.findIndex((child) =>
      isElement(child) && textOf(child).includes('metrics.increment("ttl_change")')
    );
    const unifiedSurround = unified.children[unifiedTargetIndex + 1];
    expect(unifiedTargetIndex).toBeGreaterThan(-1);
    expect(unifiedSurround).toMatchObject({
      tagName: "div",
      properties: { "data-annotation-surround": "" },
    });
    const unifiedAnnotation = isElement(unifiedSurround)
      ? findElement({
          element: unifiedSurround,
          matches: (candidate) => candidate.properties["data-annotation"] === "",
        })
      : undefined;
    expect(unifiedAnnotation).toMatchObject({
      tagName: "aside",
      properties: {
        role: "note",
        ariaLabel: "Line 13",
        "data-annotation": "",
        "data-annotation-lines": "13",
        "data-annotation-side": "new",
      },
    });
    expect(unifiedAnnotation === undefined ? "" : textOf(unifiedAnnotation)).toContain(
      "Line 13",
    );
    expect(unifiedAnnotation === undefined ? "" : textOf(unifiedAnnotation)).toContain(
      "Use the catalog prefix.",
    );

    const split = viewFrom({ element, view: "split" });
    expect(JSON.stringify(split).match(/code-diff-split-hunk/gu)).toHaveLength(1);
    const splitAnnotationParent = parentOfMatchingChild({
      element: split,
      matches: (candidate) =>
        candidate.properties["data-annotation-card"] === "annotation-1",
    });
    const splitAnnotationIndex = splitAnnotationParent?.children.findIndex((child) =>
      isElement(child) && child.properties["data-annotation-card"] === "annotation-1"
    ) ?? -1;
    const precedingSegment = splitAnnotationParent?.children[splitAnnotationIndex - 1];
    expect(splitAnnotationIndex).toBeGreaterThan(-1);
    expect(isElement(precedingSegment) ? textOf(precedingSegment) : "").toContain(
      'metrics.increment("ttl_change")',
    );
    const splitAnnotation = splitAnnotationParent?.children[splitAnnotationIndex];
    expect(isElement(splitAnnotation)
      ? textOf(splitAnnotation)
      : "").toContain("Use the catalog prefix.");
    expect(splitAnnotationParent?.properties["data-diff-pane"]).toBe("new");
    const oldPane = findElement({
      element: split,
      matches: (candidate) => candidate.properties["data-diff-pane"] === "old",
    });
    expect(JSON.stringify(oldPane)).toContain('"data-annotation-spacer":"annotation-1"');
  });

  it("should localize old and new split Annotations without changing unified placement", () => {
    const { element, diagnostics } = render({
      children: [fence({
        source: "@@ -12,2 +12,2 @@\n-old();\n+new();\n shared();\n",
      })],
      scopedChildren: [
        annotation({ lines: "12", side: "old", value: "Old-side note." }),
        annotation({ lines: "12", side: "new", value: "New-side note." }),
      ],
    });
    expect(diagnostics).toEqual([]);

    const unified = viewFrom({ element, view: "unified" });
    for (const note of ["Old-side note.", "New-side note."]) {
      expect(parentOfMatchingChild({
        element: unified,
        matches: (candidate) =>
          candidate.properties["data-annotation-surround"] === "" &&
          textOf(candidate).includes(note),
      })).toBe(unified);
    }

    const split = viewFrom({ element, view: "split" });
    const oldPane = parentOfMatchingChild({
      element: split,
      matches: (candidate) =>
        candidate.properties["data-annotation-card"] !== undefined &&
        textOf(candidate).includes("Old-side note."),
    });
    const newPane = parentOfMatchingChild({
      element: split,
      matches: (candidate) =>
        candidate.properties["data-annotation-card"] !== undefined &&
        textOf(candidate).includes("New-side note."),
    });
    expect(oldPane?.properties["data-diff-pane"]).toBe("old");
    expect(newPane?.properties["data-diff-pane"]).toBe("new");
    expect(textOf(oldPane ?? split)).not.toContain("New-side note.");
    expect(textOf(newPane ?? split)).not.toContain("Old-side note.");
    expect(JSON.stringify(oldPane)).toContain('"data-annotation-spacer":"annotation-2"');
    expect(JSON.stringify(newPane)).toContain('"data-annotation-spacer":"annotation-1"');
  });

  it("should anchor a range spanning context and added lines after its last line", () => {
    const source = "@@ -12,2 +12,3 @@\n shared();\n-old();\n+new();\n+audit();\n";
    const { element, diagnostics } = render({
      children: [fence({ source })],
      scopedChildren: [annotation({
        lines: "12-14",
        value: "Review the whole transition.",
      })],
    });
    expect(diagnostics).toEqual([]);

    for (const view of ["unified", "split"] as const) {
      const renderedView = viewFrom({ element, view });
      const annotationParent = parentOfMatchingChild({
        element: renderedView,
        matches: (candidate) =>
          candidate.properties["data-annotation-surround"] === "" &&
          textOf(candidate).includes("Lines 12-14"),
      });
      const annotationIndex = annotationParent?.children.findIndex((child) =>
        isElement(child) &&
        child.properties["data-annotation-surround"] === "" &&
        textOf(child).includes("Lines 12-14")
      ) ?? -1;
      const precedingSegment = annotationParent?.children[annotationIndex - 1];
      expect(annotationIndex).toBeGreaterThan(-1);
      expect(isElement(precedingSegment) ? textOf(precedingSegment) : "").toContain(
        "audit();",
      );
      const renderedAnnotation = annotationParent?.children[annotationIndex];
      expect(isElement(renderedAnnotation)
        ? textOf(renderedAnnotation)
        : "").toContain("Lines 12-14");
    }
    expect(JSON.stringify(element).match(/"data-annotation-anchor":""/gu))
      .toHaveLength(6);
  });

  it("should preserve authored order when multiple Annotations share a line", () => {
    const { element, diagnostics } = render({
      scopedChildren: [
        annotation({ lines: "1", value: "First review note." }),
        annotation({ lines: "1", value: "Second review note." }),
      ],
    });
    expect(diagnostics).toEqual([]);
    for (const view of ["unified", "split"] as const) {
      const rendered = textOf(viewFrom({ element, view }));
      expect(rendered.indexOf("First review note.")).toBeGreaterThan(-1);
      expect(rendered.indexOf("Second review note.")).toBeGreaterThan(
        rendered.indexOf("First review note."),
      );
    }
  });
});
