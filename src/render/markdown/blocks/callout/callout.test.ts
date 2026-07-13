// Tests Callout schema diagnostics, variant defaults, semantic markup, and
// preservation of the registry-provided HAST body.

import type { ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../diagnostics.js";
import { renderCallout } from "./callout.js";

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
  const element = renderCallout({
    attributes,
    children,
    scopedChildren: [],
    position: POSITION,
    diagnostics,
  });
  return { element, diagnostics: diagnostics.diagnostics };
};

describe("renderCallout", () => {
  it("should report the allowed values when type is missing", () => {
    expect(render({ attributes: {} }).diagnostics).toEqual([
      {
        line: 4,
        column: 1,
        message:
          'Missing required attribute "type"; expected one of: note, tip, warning, danger',
      },
    ]);
  });

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

  it("should report an unknown attribute when an extra string attribute is present", () => {
    expect(
      render({ attributes: { type: "note", tone: "quiet" } }).diagnostics,
    ).toEqual([
      {
        line: 4,
        column: 1,
        message: 'Unknown attribute "tone" on Callout',
      },
    ]);
  });

  it("should report an unknown attribute when an extra attribute is shorthand", () => {
    expect(
      render({ attributes: { type: "note", compact: true } }).diagnostics,
    ).toEqual([
      {
        line: 4,
        column: 1,
        message: 'Unknown attribute "compact" on Callout',
      },
    ]);
  });

  it("should reject a shorthand title when title is not a string", () => {
    expect(
      render({ attributes: { type: "note", title: true } }).diagnostics,
    ).toEqual([
      {
        line: 4,
        column: 1,
        message: 'Attribute "title" must be a string',
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
