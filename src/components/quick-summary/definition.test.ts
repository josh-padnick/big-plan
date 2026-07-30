// Tests QuickSummary's facet contract - Why/What/How grammar, ordering, and
// the bullet and character caps - and its rendered hero-card markup.

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

const facet = (name: string, bullets: ReadonlyArray<string>): ScopedChild => ({
  name,
  attributes: {},
  children: [
    {
      type: "element",
      tagName: "ul",
      properties: {},
      children: bullets.map(textItem),
    },
  ],
  position: FACET_POSITION,
});

const parseRenderedElement = (compiled: CompiledComponent): Element => {
  const parsed = reactToHast(compiled.presentation());
  if (parsed === undefined) {
    throw new Error("component rendered no element");
  }
  return parsed;
};

const render = (scopedChildren: ReadonlyArray<ScopedChild>) => {
  const diagnostics = createDiagnosticCollector();
  const compiled = QUICK_SUMMARY_COMPONENT_DEFINITION.compile({
    attributes: {},
    children: [],
    scopedChildren,
    position: POSITION,
    diagnostics,
  });
  return {
    element: parseRenderedElement(compiled),
    diagnostics: diagnostics.diagnostics,
  };
};

const VALID = [
  facet("Why", ["Checkout must stay fast."]),
  facet("What", ["Build a persistent retry queue."]),
  facet("How", ["Move retries into a worker.", "Ship operator controls."]),
];

describe("QUICK_SUMMARY_COMPONENT_DEFINITION", () => {
  it("should render the Why hero above What and How cards", () => {
    const { element, diagnostics } = render(VALID);
    expect(diagnostics).toEqual([]);
    expect(element.tagName).toBe("aside");
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"value":"Quick summary"');
    expect(rendered).toContain("quick-summary-why");
    for (const label of ["Why", "What", "How"]) {
      expect(rendered).toContain(`"value":"${label}"`);
    }
    expect(rendered.indexOf('"value":"Why"')).toBeLessThan(
      rendered.indexOf('"value":"What"'),
    );
  });

  it("should require Why and What", () => {
    expect(
      render([facet("How", ["Do something."])]).diagnostics.map(
        (diagnostic) => diagnostic.message,
      ),
    ).toEqual([
      "QuickSummary needs a Why section stating the business value in one sentence",
      "QuickSummary needs a What section stating what changes for the reader",
    ]);
  });

  it("should cap Why at one bullet and How at three", () => {
    expect(
      render([
        facet("Why", ["One.", "Two."]),
        facet("What", ["Build it."]),
        facet("How", ["A.", "B.", "C.", "D."]),
      ]).diagnostics.map((diagnostic) => diagnostic.message),
    ).toEqual([
      "Why allows at most 1 bullet (found 2); keep only the key points",
      "How allows at most 3 bullets (found 4); keep only the key points",
    ]);
  });

  it("should reject facets out of canonical order", () => {
    expect(
      render([
        facet("What", ["Build it."]),
        facet("Why", ["Value."]),
      ]).diagnostics.map((diagnostic) => diagnostic.message),
    ).toEqual([
      "Order QuickSummary sections Why, What, How so every plan reads the same way",
    ]);
  });

  it("should reject more than the character budget", () => {
    const long = "x".repeat(300);
    expect(
      render([facet("Why", [long]), facet("What", [long])]).diagnostics.map(
        (diagnostic) => diagnostic.message,
      ),
    ).toEqual([
      "QuickSummary allows at most 450 characters of text (found 600); summarize at the altitude of intent, not inventory",
    ]);
  });
});
