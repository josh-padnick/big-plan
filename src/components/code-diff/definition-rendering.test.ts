// Tests CodeDiff's header metadata, normalized fence copy source, dual-view
// HAST shape, line semantics, gutters, and scoped Annotation placement.

import { describe, expect, it } from "vitest";
import {
  annotation,
  fence,
  findElement,
  isElement,
  parentOfMatchingChild,
  renderCodeDiffFixture as render,
  textOf,
  viewFrom,
} from "./test-fixtures.js";

describe("renderCodeDiff output", () => {
  it("should omit the header stats by default", () => {
    const { element, diagnostics } = render();
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(element)).not.toContain("code-diff-stats");
  });

  // A components-layer hover rule loses to the row's own bg-transparent
  // utility, so the menu row's highlight has to be a utility too.
  it("should carry menu-row hover feedback as a utility", () => {
    expect(JSON.stringify(render().element)).toContain("hover:bg-edge");
  });

  it("should render the header stats when showLineCounts is set", () => {
    const { element, diagnostics } = render({
      attributes: { file: "src/retry.ts", showLineCounts: true },
    });
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(element)).toContain("code-diff-stats");
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
      children: [
        fence({
          source:
            '@@ -12 +12,2 @@\n-const ttl = 30;\n+const ttl = 60;\n+metrics.increment("ttl_change");\n',
        }),
      ],
      scopedChildren: [
        annotation({
          lines: "13",
          value: "Use the catalog prefix.",
        }),
      ],
    });
    expect(diagnostics).toEqual([]);

    const unified = viewFrom({ element, view: "unified" });
    const unifiedTargetIndex = unified.children.findIndex(
      (child) =>
        isElement(child) &&
        textOf(child).includes('metrics.increment("ttl_change")'),
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
          matches: (candidate) =>
            candidate.properties["data-annotation"] === "",
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
    expect(
      unifiedAnnotation === undefined ? "" : textOf(unifiedAnnotation),
    ).toContain("Line 13");
    expect(
      unifiedAnnotation === undefined ? "" : textOf(unifiedAnnotation),
    ).toContain("Use the catalog prefix.");

    const split = viewFrom({ element, view: "split" });
    expect(JSON.stringify(split).match(/code-diff-split-hunk/gu)).toHaveLength(
      1,
    );
    const splitAnnotationParent = parentOfMatchingChild({
      element: split,
      matches: (candidate) =>
        candidate.properties["data-annotation-card"] === "annotation-1",
    });
    const splitAnnotationIndex =
      splitAnnotationParent?.children.findIndex(
        (child) =>
          isElement(child) &&
          child.properties["data-annotation-card"] === "annotation-1",
      ) ?? -1;
    const precedingSegment =
      splitAnnotationParent?.children[splitAnnotationIndex - 1];
    expect(splitAnnotationIndex).toBeGreaterThan(-1);
    expect(
      isElement(precedingSegment) ? textOf(precedingSegment) : "",
    ).toContain('metrics.increment("ttl_change")');
    const splitAnnotation =
      splitAnnotationParent?.children[splitAnnotationIndex];
    expect(isElement(splitAnnotation) ? textOf(splitAnnotation) : "").toContain(
      "Use the catalog prefix.",
    );
    expect(splitAnnotationParent?.properties["data-diff-pane"]).toBe("new");
    const oldPane = findElement({
      element: split,
      matches: (candidate) => candidate.properties["data-diff-pane"] === "old",
    });
    expect(JSON.stringify(oldPane)).toContain(
      '"data-annotation-spacer":"annotation-1"',
    );
  });

  it("should localize old and new split Annotations without changing unified placement", () => {
    const { element, diagnostics } = render({
      children: [
        fence({
          source: "@@ -12,2 +12,2 @@\n-old();\n+new();\n shared();\n",
        }),
      ],
      scopedChildren: [
        annotation({ lines: "12", side: "old", value: "Old-side note." }),
        annotation({ lines: "12", side: "new", value: "New-side note." }),
      ],
    });
    expect(diagnostics).toEqual([]);

    const unified = viewFrom({ element, view: "unified" });
    for (const note of ["Old-side note.", "New-side note."]) {
      expect(
        parentOfMatchingChild({
          element: unified,
          matches: (candidate) =>
            candidate.properties["data-annotation-surround"] === "" &&
            textOf(candidate).includes(note),
        }),
      ).toBe(unified);
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
    expect(JSON.stringify(oldPane)).toContain(
      '"data-annotation-spacer":"annotation-2"',
    );
    expect(JSON.stringify(newPane)).toContain(
      '"data-annotation-spacer":"annotation-1"',
    );
  });

  it("should anchor a range spanning context and added lines after its last line", () => {
    const source =
      "@@ -12,2 +12,3 @@\n shared();\n-old();\n+new();\n+audit();\n";
    const { element, diagnostics } = render({
      children: [fence({ source })],
      scopedChildren: [
        annotation({
          lines: "12-14",
          value: "Review the whole transition.",
        }),
      ],
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
      const annotationIndex =
        annotationParent?.children.findIndex(
          (child) =>
            isElement(child) &&
            child.properties["data-annotation-surround"] === "" &&
            textOf(child).includes("Lines 12-14"),
        ) ?? -1;
      const precedingSegment = annotationParent?.children[annotationIndex - 1];
      expect(annotationIndex).toBeGreaterThan(-1);
      expect(
        isElement(precedingSegment) ? textOf(precedingSegment) : "",
      ).toContain("audit();");
      const renderedAnnotation = annotationParent?.children[annotationIndex];
      expect(
        isElement(renderedAnnotation) ? textOf(renderedAnnotation) : "",
      ).toContain("Lines 12-14");
    }
    // Anchors carry the ids of the annotations covering them, so hover can
    // link each card with its lines.
    expect(
      JSON.stringify(element).match(/"data-annotation-anchor":"[^"]+"/gu),
    ).toHaveLength(6);
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
