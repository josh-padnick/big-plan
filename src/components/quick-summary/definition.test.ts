// Tests QuickSummary's structural contract - one bullet list, the item and
// character caps - and its rendered card markup.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import type { CompiledComponent } from "../_registration/define-component.js";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { QUICK_SUMMARY_COMPONENT_DEFINITION } from "./definition.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 9, column: 16, offset: 200 },
};

const textItem = (value: string): ElementContent => ({
  type: "element",
  tagName: "li",
  properties: {},
  children: [{ type: "text", value }],
});

const bulletList = (items: ReadonlyArray<ElementContent>): ElementContent => ({
  type: "element",
  tagName: "ul",
  properties: {},
  children: [...items],
});

const parseRenderedElement = (compiled: CompiledComponent): Element => {
  const parsed = reactToHast(compiled.presentation());
  if (parsed === undefined) {
    throw new Error("component rendered no element");
  }
  return parsed;
};

const render = (children: ReadonlyArray<ElementContent>) => {
  const diagnostics = createDiagnosticCollector();
  const compiled = QUICK_SUMMARY_COMPONENT_DEFINITION.compile({
    attributes: {},
    children,
    scopedChildren: [],
    position: POSITION,
    diagnostics,
  });
  return {
    element: parseRenderedElement(compiled),
    diagnostics: diagnostics.diagnostics,
  };
};

describe("QUICK_SUMMARY_COMPONENT_DEFINITION", () => {
  it("should render the labeled card when the summary is within its caps", () => {
    const { element, diagnostics } = render([
      bulletList([textItem("One change."), textItem("One risk.")]),
    ]);
    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("aside");
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"value":"Quick summary"');
    expect(rendered).toContain('"value":"One change."');
    expect(rendered).toContain('"value":"One risk."');
  });

  it("should reject a body that is not exactly one bullet list", () => {
    const paragraph: ElementContent = {
      type: "element",
      tagName: "p",
      properties: {},
      children: [{ type: "text", value: "Prose instead of bullets." }],
    };
    expect(render([paragraph]).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "QuickSummary must contain exactly one bullet list and nothing else",
      },
    ]);
    expect(
      render([bulletList([textItem("A.")]), paragraph]).diagnostics,
    ).toHaveLength(1);
  });

  it("should reject an empty list", () => {
    expect(render([bulletList([])]).diagnostics).toEqual([
      { line: 3, column: 1, message: "QuickSummary needs at least one bullet" },
    ]);
  });

  it("should reject more than five bullets", () => {
    const items = Array.from({ length: 6 }, (_, i) => textItem(`Point ${i}.`));
    expect(render([bulletList(items)]).diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "QuickSummary allows at most 5 bullets (found 6); keep only the key points",
      },
    ]);
  });

  it("should reject more than six hundred readable characters", () => {
    const long = "x".repeat(301);
    const { diagnostics } = render([
      bulletList([textItem(long), textItem(long)]),
    ]);
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "QuickSummary allows at most 600 characters of text (found 602); summarize at the altitude of intent, not inventory",
      },
    ]);
  });

  it("should count characters inside inline markup and collapse whitespace", () => {
    const styledItem: ElementContent = {
      type: "element",
      tagName: "li",
      properties: {},
      children: [
        { type: "text", value: "Uses  " },
        {
          type: "element",
          tagName: "code",
          properties: {},
          children: [{ type: "text", value: "big-plan validate" }],
        },
      ],
    };
    const filler = "y".repeat(579);
    const { diagnostics } = render([
      bulletList([styledItem, textItem(filler)]),
    ]);
    // "Uses big-plan validate" is 22 readable characters after collapsing.
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "QuickSummary allows at most 600 characters of text (found 601); summarize at the altitude of intent, not inventory",
      },
    ]);
  });
});
