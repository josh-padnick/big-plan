// Tests QuickSummary's facet contract - What/How/Risks/Decisions grammar,
// ordering, and the bullet and character caps - and its rendered card markup.

import type { Element, ElementContent } from "hast";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import type { ScopedChild } from "../_authoring/contract.js";
import type { CompiledComponent } from "../_registration/define-component.js";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { QUICK_SUMMARY_COMPONENT_DEFINITION } from "./definition.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 20, column: 16, offset: 400 },
};

const FACET_POSITION = {
  start: { line: 5, column: 1, offset: 30 },
  end: { line: 9, column: 8, offset: 90 },
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

const facet = (name: string, bullets: ReadonlyArray<string>): ScopedChild => ({
  name,
  attributes: {},
  children: [bulletList(bullets.map(textItem))],
  position: FACET_POSITION,
});

const parseRenderedElement = (compiled: CompiledComponent): Element => {
  const parsed = reactToHast(compiled.presentation());
  if (parsed === undefined) {
    throw new Error("component rendered no element");
  }
  return parsed;
};

const render = ({
  children = [],
  scopedChildren,
}: {
  readonly children?: ReadonlyArray<ElementContent>;
  readonly scopedChildren: ReadonlyArray<ScopedChild>;
}) => {
  const diagnostics = createDiagnosticCollector();
  const compiled = QUICK_SUMMARY_COMPONENT_DEFINITION.compile({
    attributes: {},
    children,
    scopedChildren,
    position: POSITION,
    diagnostics,
  });
  return {
    element: parseRenderedElement(compiled),
    diagnostics: diagnostics.diagnostics,
  };
};

describe("QUICK_SUMMARY_COMPONENT_DEFINITION", () => {
  it("should render the facet grid when every facet is within its caps", () => {
    const { element, diagnostics } = render({
      scopedChildren: [
        facet("What", ["Retries move into a queue."]),
        facet("How", ["A worker drains it with backoff."]),
        facet("Risks", ["Double charges without transactions."]),
        facet("Decisions", ["Queue technology."]),
      ],
    });
    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("aside");
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"value":"Quick summary"');
    for (const label of ["What", "How", "Risks", "Decisions"]) {
      expect(rendered).toContain(`"value":"${label}"`);
    }
    expect(rendered).toContain('"tagName":"dl"');
    expect(rendered).toContain('"value":"Retries move into a queue."');
  });

  it("should require the What facet", () => {
    expect(
      render({ scopedChildren: [facet("How", ["Something."])] }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "QuickSummary needs a What section stating what changes for the reader",
      },
    ]);
  });

  it("should reject loose content outside the facets", () => {
    const paragraph: ElementContent = {
      type: "element",
      tagName: "p",
      properties: {},
      children: [{ type: "text", value: "Loose prose." }],
    };
    expect(
      render({
        children: [paragraph],
        scopedChildren: [facet("What", ["A change."])],
      }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "QuickSummary holds only What, How, Risks, and Decisions sections; move loose content into one of them",
      },
    ]);
  });

  it("should reject duplicate facets", () => {
    expect(
      render({
        scopedChildren: [
          facet("What", ["A change."]),
          facet("What", ["Another change."]),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 5,
        column: 1,
        message: "QuickSummary allows one What section",
      },
    ]);
  });

  it("should reject facets out of canonical order", () => {
    expect(
      render({
        scopedChildren: [
          facet("Risks", ["A risk."]),
          facet("What", ["A change."]),
        ],
      }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "Order QuickSummary sections What, How, Risks, Decisions so every plan reads the same way",
      },
    ]);
  });

  it("should reject a facet body that is not exactly one bullet list", () => {
    const prose: ScopedChild = {
      name: "What",
      attributes: {},
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [{ type: "text", value: "Prose instead of bullets." }],
        },
      ],
      position: FACET_POSITION,
    };
    expect(render({ scopedChildren: [prose] }).diagnostics).toEqual([
      {
        line: 5,
        column: 1,
        message: "What must contain exactly one bullet list and nothing else",
      },
    ]);
  });

  it("should reject more than three bullets in one facet", () => {
    expect(
      render({
        scopedChildren: [facet("What", ["A.", "B.", "C.", "D."])],
      }).diagnostics,
    ).toEqual([
      {
        line: 5,
        column: 1,
        message:
          "What allows at most 3 bullets (found 4); keep only the key points",
      },
    ]);
  });

  it("should reject more than six hundred readable characters across facets", () => {
    const long = "x".repeat(301);
    expect(
      render({
        scopedChildren: [facet("What", [long]), facet("Risks", [long])],
      }).diagnostics,
    ).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "QuickSummary allows at most 600 characters of text (found 602); summarize at the altitude of intent, not inventory",
      },
    ]);
  });

  it("should render facets in canonical order regardless of model input", () => {
    const { element } = render({
      scopedChildren: [
        facet("What", ["A change."]),
        facet("Decisions", ["A call."]),
      ],
    });
    const rendered = JSON.stringify(element);
    expect(rendered.indexOf('"value":"What"')).toBeLessThan(
      rendered.indexOf('"value":"Decisions"'),
    );
  });
});
