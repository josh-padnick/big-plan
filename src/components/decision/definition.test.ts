// Tests Decision's contract - option and consideration grammar, the
// recommendation, selection, and comparability invariants - and the
// comparison-matrix markup its selector renders.

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
  chosen = false,
  considerations,
}: {
  readonly title: string;
  readonly recommended?: boolean;
  readonly chosen?: boolean;
  readonly considerations: ReadonlyArray<ScopedChild>;
}): ScopedChild => ({
  name: "Option",
  attributes: {
    title,
    ...(recommended ? { recommended: true } : {}),
    ...(chosen ? { chosen: true } : {}),
  },
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

const render = (
  scopedChildren: ReadonlyArray<ScopedChild>,
  status?: string,
) => {
  const diagnostics = createDiagnosticCollector();
  const compiled = DECISION_COMPONENT_DEFINITION.compile({
    attributes: {
      question: "Which channel?",
      ...(status === undefined ? {} : { status }),
    },
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

const twoOptions = ({
  chosen = false,
}: { readonly chosen?: boolean } = {}): ReadonlyArray<ScopedChild> => [
  option({
    title: "Embedded",
    recommended: true,
    considerations: [consideration("Version fidelity", "Exact", "good")],
  }),
  option({
    title: "Download",
    chosen,
    considerations: [consideration("Version fidelity", "Drifts", "bad")],
  }),
];

describe("DECISION_COMPONENT_DEFINITION", () => {
  it("should render an open decision as a comparison matrix with a radio per column", () => {
    const { element, diagnostics } = render(twoOptions());
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(element.tagName).toBe("figure");
    expect(rendered).toContain('"value":"Which channel?"');
    expect(rendered).toContain('"value":"Embedded"');
    expect(rendered).toContain('"value":"Recommended"');
    expect(rendered).toContain('"value":"Version fidelity"');
    expect(rendered).toContain('"value":"Exact"');
    expect(rendered).toContain("matrix-tone-good");
    expect(rendered).toContain("matrix-tone-bad");
    expect(rendered).toContain("comparison-matrix");
    expect(rendered).toContain('"type":"radio"');
    expect(rendered).toContain("data-decision-selector");
    expect(rendered).toContain("decision-matrix");
    expect(rendered).toContain("data-decision-column");
  });

  it("should give every verdict a word and a glyph, never colour alone", () => {
    const { element } = render(twoOptions());
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"data-lucide":"check"');
    expect(rendered).toContain('"data-lucide":"x"');
    expect(rendered).toContain('"value":" (Favourable)"');
    expect(rendered).toContain('"value":" (Unfavourable)"');
  });

  it("should default the rationale panel to the recommended option", () => {
    const { element } = render(twoOptions());
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"data-default-index":"0"');
    expect(rendered).toContain("data-rationale-default");
    expect(
      JSON.stringify(element).split("data-rationale-panel").length - 1,
    ).toBe(2);
  });

  it("should offer a proposal link and a disabled confirm action when open", () => {
    const { element } = render(twoOptions());
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"value":"Propose another approach"');
    expect(rendered).toContain("decision-propose-link");
    expect(rendered).toContain("data-decision-proposal-text");
    expect(rendered).toContain('"value":"Confirm choice"');
    expect(rendered).toContain('"disabled":true');
    expect(rendered).toContain('"value":"Nothing selected yet."');
  });

  it("should render a decided decision as a record without a selector", () => {
    const { element, diagnostics } = render(
      twoOptions({ chosen: true }),
      "decided",
    );
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"value":"Decided"');
    expect(rendered).toContain("data-option-chosen");
    expect(rendered).not.toContain("data-decision-selector");
    expect(rendered).not.toContain('"value":"Propose another approach"');
    expect(rendered).not.toContain('"value":"Confirm choice"');
  });

  it("should never label an open decision with a status badge", () => {
    const { element } = render(twoOptions());
    expect(JSON.stringify(element)).not.toContain('"value":"Open"');
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

  it("should reject options that do not compare the same considerations", () => {
    const { diagnostics } = render([
      option({
        title: "A",
        considerations: [consideration("Cost", "Low")],
      }),
      option({
        title: "B",
        considerations: [consideration("Effort", "High")],
      }),
    ]);
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          'Every Decision Option must list the same Considerations in the same order so options stay comparable; "B" does not match "A"',
      },
    ]);
  });

  it("should reject a verdict too long to compare at a glance", () => {
    const { diagnostics } = render([
      option({
        title: "A",
        considerations: [consideration("Cost", "Low once the cache warms up")],
      }),
      option({
        title: "B",
        considerations: [consideration("Cost", "High")],
      }),
    ]);
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message:
          "A Consideration verdict must be at most 24 characters so options stay scannable; move the reasoning into the Consideration body",
      },
    ]);
  });

  it("should reject duplicate option titles", () => {
    const { diagnostics } = render([
      option({
        title: "Embedded",
        considerations: [consideration("Cost", "Low")],
      }),
      option({
        title: "Embedded",
        considerations: [consideration("Cost", "High")],
      }),
    ]);
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'Duplicate Option title "Embedded" in Decision',
      },
    ]);
  });

  it("should render the proposal field without needing a script to reveal it", () => {
    const { element } = render(twoOptions());
    const rendered = JSON.stringify(element);
    const field = rendered.slice(rendered.indexOf('data-decision-proposal"'));
    // The hidden attribute would make the field script-only; CSS keyed on the
    // radio is what keeps it reachable with scripts disabled.
    expect(field.slice(0, 200)).not.toContain('"hidden":true');
  });

  it("should mark the compare and explain zones so an answer can retire them", () => {
    const { element } = render(twoOptions());
    const rendered = JSON.stringify(element);
    expect(rendered).toContain("data-decision-compare");
    expect(rendered).toContain("data-decision-explain");
  });

  it("should reject a chosen option outside a decided decision", () => {
    const { diagnostics } = render(twoOptions({ chosen: true }));
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'A Decision with a chosen Option must set status="decided"',
      },
    ]);
  });

  it("should reject a decided decision with no chosen option", () => {
    const { diagnostics } = render(twoOptions(), "decided");
    expect(diagnostics).toEqual([
      {
        line: 3,
        column: 1,
        message: 'A Decision with status="decided" must mark one Option chosen',
      },
    ]);
  });
});
