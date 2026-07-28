// Tests Callout schema diagnostics, variant defaults, semantic markup, and
// preservation of the registry-provided HAST body.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../../../../model/diagnostics.js";
import { fromHtml } from "hast-util-from-html";
import { normalizeReparsedProperties } from "../registry.js";
import { CALLOUT_COMPONENT_DEFINITION } from "./callout.js";

// The React port renders a string; reparsing mirrors the registry's own
// splice so traversal assertions keep exercising the shipped markup.
const parseRenderedElement = (html: string): Element => {
  const fragment = fromHtml(html, { fragment: true });
  normalizeReparsedProperties(fragment.children);
  const parsed = fragment.children.find(
    (child): child is Element => child.type === "element",
  );
  if (parsed === undefined) {
    throw new Error("component rendered no element");
  }
  return parsed;
};

const POSITION = {
  start: { line: 4, column: 1, offset: 20 },
  end: { line: 6, column: 11, offset: 80 },
};

const render = ({
  attributes,
  children = [],
}: {
  readonly attributes: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
}) => {
  const diagnostics = createDiagnosticCollector();
  const element = parseRenderedElement(
    CALLOUT_COMPONENT_DEFINITION.renderStatic({
      attributes,
      children,
      scopedChildren: [],
      position: POSITION,
      diagnostics,
    }),
  );
  return { element, diagnostics: diagnostics.diagnostics };
};

describe("CALLOUT_COMPONENT_DEFINITION", () => {
  it("should report the allowed values when type is invalid", () => {
    expect(render({ attributes: { type: "success" } }).diagnostics).toEqual([
      {
        line: 4,
        column: 1,
        message:
          'Invalid value for attribute "type"; expected one of: note, tip, warning, danger',
      },
    ]);
  });

  it("should render the custom title when title is supplied", () => {
    const { element, diagnostics } = render({
      attributes: { type: "warning", title: "Review goal" },
    });
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(element.tagName).toBe("aside");
    expect(element.properties["data-callout"]).toBe("warning");
    expect(rendered).toContain('"tagName":"header"');
    expect(rendered).toContain('"tagName":"svg"');
    expect(rendered).toContain('"ariaHidden":"true"');
    expect(rendered).toContain('"value":"Review goal"');
  });

  it.each([
    ["note", "Note", "info"],
    ["tip", "Tip", "lightbulb"],
    ["warning", "Warning", "triangle-alert"],
    ["danger", "Danger", "octagon-alert"],
  ])(
    "should render the default title and icon when type is %s",
    (type, title, iconName) => {
      const { element, diagnostics } = render({ attributes: { type } });
      expect(diagnostics).toEqual([]);
      const rendered = JSON.stringify(element);
      expect(element.properties["data-callout"]).toBe(type);
      expect(rendered).toContain(`"data-lucide":"${iconName}"`);
      expect(rendered).toContain('"ariaHidden":"true"');
      expect(rendered).toContain(`"value":"${title}"`);
    },
  );

  it("should preserve nested HAST children when the body contains markdown", () => {
    const children: ReadonlyArray<ElementContent> = [
      {
        type: "element",
        tagName: "h3",
        properties: {},
        children: [{ type: "text", value: "Nested heading" }],
      },
      {
        type: "element",
        tagName: "ul",
        properties: {},
        children: [],
      },
    ];
    const { element } = render({ attributes: { type: "tip" }, children });
    expect(element.children[1]).toMatchObject({ children });
  });

  it("should render an empty body when children are empty", () => {
    const { element, diagnostics } = render({ attributes: { type: "note" } });
    expect(diagnostics).toEqual([]);
    expect(element.children[1]).toMatchObject({
      tagName: "div",
      children: [],
    });
  });
});
