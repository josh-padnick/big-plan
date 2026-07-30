// Tests TableOfContents schema diagnostics, the Entry child contract, and
// the placeholder overview markup rendered without a completed outline.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import type { ScopedChild } from "../_authoring/contract.js";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import type { CompiledComponent } from "../_registration/define-component.js";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { TABLE_OF_CONTENTS_COMPONENT_DEFINITION } from "./definition.js";

const parseRenderedElement = (compiled: CompiledComponent): Element => {
  const parsed = reactToHast(compiled.presentation());
  if (parsed === undefined) {
    throw new Error("component rendered no element");
  }
  return parsed;
};

const POSITION = {
  start: { line: 5, column: 1, offset: 30 },
  end: { line: 9, column: 10, offset: 160 },
};

const ITEM_POSITION = {
  start: { line: 6, column: 1, offset: 40 },
  end: { line: 6, column: 50, offset: 89 },
};

const entry = (
  attributes: Readonly<Record<string, string | boolean>>,
  children: ReadonlyArray<ElementContent> = [],
): ScopedChild => ({
  name: "Entry",
  attributes,
  children,
  position: ITEM_POSITION,
});

const render = ({
  scopedChildren = [],
  children = [],
}: {
  readonly scopedChildren?: ReadonlyArray<ScopedChild>;
  readonly children?: ReadonlyArray<ElementContent>;
}) => {
  const diagnostics = createDiagnosticCollector();
  const element = parseRenderedElement(
    TABLE_OF_CONTENTS_COMPONENT_DEFINITION.compile({
      attributes: {},
      children,
      scopedChildren,
      position: POSITION,
      diagnostics,
    }),
  );
  return { element, diagnostics: diagnostics.diagnostics };
};

describe("TABLE_OF_CONTENTS_COMPONENT_DEFINITION", () => {
  it("should report an empty TableOfContents when no Entry exists", () => {
    expect(render({}).diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          "TableOfContents needs at least one Entry naming a section and its gist",
      },
    ]);
  });

  it("should report loose content when the body is not only Items", () => {
    const children: ReadonlyArray<ElementContent> = [
      {
        type: "element",
        tagName: "p",
        properties: {},
        children: [{ type: "text", value: "stray prose" }],
      },
    ];
    const { diagnostics } = render({
      scopedChildren: [entry({ section: "Status quo", gist: "Today" })],
      children,
    });
    expect(diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message:
          "TableOfContents holds only Entry rows; move loose content into the plan body",
      },
    ]);
  });

  it("should report missing Entry attributes at the entry's position", () => {
    const { diagnostics } = render({
      scopedChildren: [entry({ section: "Status quo" })],
    });
    expect(diagnostics).toEqual([
      {
        line: 6,
        column: 1,
        message: 'Missing required attribute "gist"; expected a string',
      },
    ]);
  });

  it("should report empty Entry attributes at the entry's position", () => {
    const { diagnostics } = render({
      scopedChildren: [entry({ section: " ", gist: "Today" })],
    });
    expect(diagnostics).toEqual([
      {
        line: 6,
        column: 1,
        message: 'Attribute "section" must be a non-empty string',
      },
    ]);
  });

  it("should reject Entry body content when an entry is not self-closing", () => {
    const { diagnostics } = render({
      scopedChildren: [
        entry({ section: "Status quo", gist: "Today" }, [
          {
            type: "element",
            tagName: "p",
            properties: {},
            children: [{ type: "text", value: "body" }],
          },
        ]),
      ],
    });
    expect(diagnostics).toEqual([
      {
        line: 6,
        column: 1,
        message:
          'Entry is self-closing; write <Entry section="..." gist="..." /> with no body content',
      },
    ]);
  });

  // The row's own text-ink utility beats a components-layer rule, so the title
  // accent has to arrive as a group variant or the hover goes unnoticed.
  it("should carry row-hover title accent as a utility", () => {
    const rendered = JSON.stringify(
      render({
        scopedChildren: [entry({ section: "Status quo", gist: "A gist" })],
      }).element,
    );

    expect(rendered).toContain("group-hover:text-accent");
  });

  it("should render placeholder rows without a completed outline", () => {
    const { element, diagnostics } = render({
      scopedChildren: [
        entry({ section: "Status quo", gist: "Docs promise a skill" }),
        entry({ section: "The design", gist: "Embed it in the CLI" }),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("nav");
    expect(element.properties["data-table-of-contents"]).toBe("true");
    expect(element.properties.ariaLabel).toBe("The plan in one look");
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"value":"The plan in one look"');
    expect(rendered).toContain('"value":"Status quo"');
    expect(rendered).toContain('"value":"Docs promise a skill"');
    const rows = element.children.filter(
      (child) =>
        child.type === "element" &&
        child.properties["data-table-of-contents-row"] !== undefined,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      tagName: "a",
      properties: { href: "#" },
    });
  });
});
