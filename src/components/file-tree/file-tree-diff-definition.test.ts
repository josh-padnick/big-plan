// Tests FileTreeDiff diagnostics and its server-rendered combined plus
// before/after HAST views, including rename display and marker sidedness.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import type { CompiledComponent } from "../_registration/define-component.js";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { FILE_TREE_DIFF_COMPONENT_DEFINITION } from "./file-tree-diff-definition.js";

const parseRenderedElement = (compiled: CompiledComponent): Element => {
  const parsed = reactToHast(compiled.presentation());
  if (parsed === undefined) {
    throw new Error("component rendered no element");
  }
  return parsed;
};

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 9, column: 12, offset: 100 },
};

const fence = ({
  language = "tree",
  source = "src/\n  old.ts -> new.ts [renamed]\n  created.ts [added]\n  deleted.ts [removed]\n",
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
  const element = parseRenderedElement(
    FILE_TREE_DIFF_COMPONENT_DEFINITION.compile({
      attributes,
      children,
      scopedChildren: [],
      position: POSITION,
      diagnostics,
    }),
  );
  return { element, diagnostics: diagnostics.diagnostics };
};

const contentView = ({
  element,
  view,
}: {
  readonly element: Element;
  readonly view: "combined" | "before-after";
}): Element | undefined =>
  element.children.find(
    (child): child is Element =>
      child.type === "element" &&
      child.properties["data-tree-content"] === view,
  );

describe("renderFileTreeDiff", () => {
  it("should diagnose a missing tree fence", () => {
    expect(render({ children: [] }).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "FileTreeDiff expects exactly one fenced code block with language tree and no other content",
      },
    ]);
  });

  it("should reject a zero-badge hierarchy in favor of FileTree", () => {
    expect(
      render({
        children: [fence({ source: "src/\n  index.ts - Entry point.\n" })],
      }).diagnostics,
    ).toContainEqual({
      line: 3,
      column: 1,
      message:
        "FileTreeDiff requires at least one change badge; use FileTree for a plain hierarchy",
    });
  });

  it("should render both views with combined as the default", () => {
    const { element, diagnostics } = render({
      attributes: { title: "Changes" },
    });
    expect(diagnostics).toEqual([]);
    expect(element.properties["data-tree-view"]).toBe("combined");
    expect(contentView({ element, view: "combined" })).toBeDefined();
    expect(contentView({ element, view: "before-after" })).toBeDefined();
    expect(JSON.stringify(element)).toContain('"data-tree-toggle-group":""');
  });

  it("should put old and new rename names in their matching views", () => {
    const { element } = render();
    const combined = JSON.stringify(contentView({ element, view: "combined" }));
    const states = contentView({ element, view: "before-after" });
    const before = JSON.stringify(states?.children[0]);
    const after = JSON.stringify(states?.children[1]);

    expect(combined).toContain('"value":"old.ts -> new.ts"');
    expect(before).toContain('"value":"old.ts"');
    expect(before).not.toContain('"value":"new.ts"');
    expect(after).toContain('"value":"new.ts"');
    expect(after).not.toContain('"value":"old.ts"');
  });

  it("should let hideDiff author the switch off while defaulting to on", () => {
    const shown = render({ attributes: { title: "Changes" } }).element;
    expect(shown.properties["data-tree-changes"]).toBe("shown");
    expect(JSON.stringify(shown)).toContain('"data-state":"checked"');

    const { element, diagnostics } = render({
      attributes: { title: "Changes", hideDiff: true },
    });
    expect(diagnostics).toEqual([]);
    expect(element.properties["data-tree-changes"]).toBe("hidden");
    expect(JSON.stringify(element)).toContain('"data-state":"unchecked"');
  });

  it("should label header controls with a fast hint instead of a native title", () => {
    const serialized = JSON.stringify(render().element);

    expect(serialized).toContain('"data-tooltip":"Collapse all folders"');
    expect(serialized).toContain('"data-tooltip":"View file tree full screen"');
    expect(serialized).toContain('"data-tooltip":"Side-by-side view"');
    expect(serialized).not.toContain('"title":');
  });

  // These states have to ride on utilities. Expressed as stylesheet rules in
  // the components layer they lose to the buttons' resting background utility,
  // which is how both silently stopped rendering.
  it("should carry header-control hover and pressed backgrounds as utilities", () => {
    const controls = JSON.stringify(render().element);

    expect(controls).toContain("hover:bg-edge");
    expect(controls).toContain("aria-pressed:bg-edge");
    // Segmented rounding stands in for the overflow clipping that used to cut
    // these controls' hover hints off.
    expect(controls).toContain("first:rounded-l-[0.3125rem]");
  });

  it("should open an entry note as a hover popover rather than a native title", () => {
    const serialized = JSON.stringify(
      render({
        children: [
          fence({ source: "src/\n  added.ts [added] - Entry point.\n" }),
        ],
      }).element,
    );

    expect(serialized).toContain('"data-info-popover":"true"');
    expect(serialized).toContain('"data-info-popover-body":"true"');
    expect(serialized).toContain('"value":"Entry point."');
    expect(serialized).not.toContain('"title":');
    // The open glyph darkens through a group variant; a stylesheet rule would
    // lose to the summary's own text-muted utility.
    expect(serialized).toContain("group-open:text-ink");
  });

  it("should keep the before pane unmarked and every marker on the after pane", () => {
    const states = contentView({
      element: render().element,
      view: "before-after",
    });
    const before = JSON.stringify(states?.children[0]);
    const after = JSON.stringify(states?.children[1]);

    expect(before).not.toContain('"data-tree-badge"');
    expect(after).toContain('"data-tree-badge":"added"');
    expect(after).toContain('"data-tree-badge":"removed"');
    expect(after).toContain('"data-tree-badge":"renamed"');
  });
});
