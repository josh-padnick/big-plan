// Tests Part schema diagnostics, the self-closing body contract, anchor
// allocation, and the divider markup the deck transform completes.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { createComponentIdAllocator } from "../_authoring/contract.js";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import type { CompiledComponent } from "../_registration/define-component.js";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { PART_COMPONENT_DEFINITION } from "./definition.js";

const parseRenderedElement = (compiled: CompiledComponent): Element => {
  const parsed = reactToHast(compiled.presentation());
  if (parsed === undefined) {
    throw new Error("component rendered no element");
  }
  return parsed;
};

const POSITION = {
  start: { line: 4, column: 1, offset: 20 },
  end: { line: 4, column: 26, offset: 45 },
};

const render = ({
  attributes,
  children = [],
  reservedIds = [],
}: {
  readonly attributes: Readonly<Record<string, string | boolean>>;
  readonly children?: ReadonlyArray<ElementContent>;
  readonly reservedIds?: ReadonlyArray<string>;
}) => {
  const diagnostics = createDiagnosticCollector();
  const element = parseRenderedElement(
    PART_COMPONENT_DEFINITION.compile({
      attributes,
      children,
      scopedChildren: [],
      position: POSITION,
      diagnostics,
      ids: createComponentIdAllocator({ reservedIds }),
    }),
  );
  return { element, diagnostics: diagnostics.diagnostics };
};

describe("PART_COMPONENT_DEFINITION", () => {
  it("should report a missing title when the attribute is absent", () => {
    expect(render({ attributes: {} }).diagnostics).toEqual([
      {
        line: 4,
        column: 1,
        message: 'Missing required attribute "title"; expected a string',
      },
    ]);
  });

  it("should report an empty title when the attribute is blank", () => {
    expect(render({ attributes: { title: "  " } }).diagnostics).toEqual([
      {
        line: 4,
        column: 1,
        message: 'Attribute "title" must be a non-empty string',
      },
    ]);
  });

  it("should reject body content when the marker is not self-closing", () => {
    const children: ReadonlyArray<ElementContent> = [
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [{ type: "text", value: "loose prose" }],
      },
    ];
    expect(
      render({ attributes: { title: "Context" }, children }).diagnostics,
    ).toEqual([
      {
        line: 4,
        column: 1,
        message:
          'Part is a self-closing divider between sections; write <Part title="..." /> with no body content',
      },
    ]);
  });

  it("should render the anchored divider band when the title is valid", () => {
    const { element, diagnostics } = render({
      attributes: { title: "The proposal" },
    });
    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("div");
    expect(element.properties["data-part"]).toBe("true");
    expect(element.properties["data-part-title"]).toBe("The proposal");
    expect(element.properties.id).toBe("part-the-proposal");
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"data-part-number"');
    expect(rendered).toContain('"value":"The proposal"');
  });

  it("should allocate a distinct anchor when a heading occupies the slug", () => {
    const { element } = render({
      attributes: { title: "Context" },
      reservedIds: ["part-context"],
    });
    expect(element.properties.id).toBe("part-context-2");
  });

  it("should leave the number slot empty for the deck transform to fill", () => {
    const { element } = render({ attributes: { title: "Context" } });
    const numberSlot = element.children.find(
      (child) =>
        child.type === "element" &&
        child.properties["data-part-number"] !== undefined,
    );
    expect(numberSlot).toMatchObject({ children: [] });
  });
});
