// Tests Decision's contract - option and consideration grammar, the
// recommendation invariant - and its rendered option-card markup.

import type { Element } from "hast";
import { describe, expect, it } from "vitest";
import { createDiagnosticCollector } from "../_authoring/diagnostics.js";
import type { ScopedChild } from "../_authoring/contract.js";
import type { CompiledComponent } from "../_registration/define-component.js";
import { reactToHast } from "../../render/markdown/component-pipeline/react-hast-adapter.js";
import { DECISION_COMPONENT_DEFINITION } from "./definition.js";

const POSITION = {
  start: { line: 3, column: 1, offset: 10 },
  end: { line: 30, column: 12, offset: 600 },
};

const consideration = (
  title: string,
  verdict: string,
  tone?: string,
): ScopedChild => ({
  name: "Consideration",
  attributes: { title, verdict, ...(tone === undefined ? {} : { tone }) },
  children: [],
  position: POSITION,
});

const option = ({
  title,
  recommended = false,
  considerations,
}: {
  readonly title: string;
  readonly recommended?: boolean;
  readonly considerations: ReadonlyArray<ScopedChild>;
}): ScopedChild => ({
  name: "Option",
  attributes: { title, ...(recommended ? { recommended: true } : {}) },
  children: [],
  scopedChildren: considerations,
  position: POSITION,
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
  const compiled = DECISION_COMPONENT_DEFINITION.compile({
    attributes: { question: "Which channel?" },
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

describe("DECISION_COMPONENT_DEFINITION", () => {
  it("should render option cards with inline considerations", () => {
    const { element, diagnostics } = render([
      option({
        title: "Embedded",
        recommended: true,
        considerations: [consideration("Version fidelity", "Exact", "good")],
      }),
      option({
        title: "Download",
        considerations: [consideration("Version fidelity", "Drifts", "bad")],
      }),
    ]);
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(element.tagName).toBe("aside");
    expect(rendered).toContain('"value":"Which channel?"');
    expect(rendered).toContain('"value":"Embedded"');
    expect(rendered).toContain('"value":"Recommended"');
    expect(rendered).toContain('"value":"Version fidelity:"');
    expect(rendered).toContain('"value":"Exact."');
    expect(rendered).toContain("decision-verdict-good");
    expect(rendered).toContain("decision-verdict-bad");
  });

  it("should require at least two options", () => {
    const { diagnostics } = render([
      option({
        title: "Only one",
        considerations: [consideration("Cost", "Low")],
      }),
    ]);
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "Decision must contain at least two Options",
      },
    ]);
  });

  it("should require considerations on every option", () => {
    const { diagnostics } = render([
      option({ title: "A", considerations: [] }),
      option({ title: "B", considerations: [consideration("Cost", "Low")] }),
    ]);
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "A Decision Option needs at least one Consideration",
      },
    ]);
  });

  it("should reject two recommended options", () => {
    const { diagnostics } = render([
      option({
        title: "A",
        recommended: true,
        considerations: [consideration("Cost", "Low")],
      }),
      option({
        title: "B",
        recommended: true,
        considerations: [consideration("Cost", "High")],
      }),
    ]);
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: "Decision cannot contain more than one recommended Option",
      },
    ]);
  });
});
