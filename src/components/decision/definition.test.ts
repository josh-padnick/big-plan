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
  summary,
  recommended = false,
  chosen = false,
  considerations,
}: {
  readonly title: string;
  readonly summary?: string;
  readonly recommended?: boolean;
  readonly chosen?: boolean;
  readonly considerations: ReadonlyArray<ScopedChild>;
}): ScopedChild => ({
  name: "Option",
  attributes: {
    title,
    ...(summary === undefined ? {} : { summary }),
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
  layout?: string,
) => {
  const diagnostics = createDiagnosticCollector();
  const compiled = DECISION_COMPONENT_DEFINITION.compile({
    attributes: {
      question: "Which channel?",
      ...(status === undefined ? {} : { status }),
      ...(layout === undefined ? {} : { layout }),
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
    summary: "Ships with the command.",
    recommended: true,
    considerations: [consideration("Version fidelity", "Exact", "good")],
  }),
  option({
    title: "Download",
    summary: "Ships as a separate file.",
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
    expect(rendered).toContain("comparison-matrix");
    expect(rendered).toContain('"type":"radio"');
    expect(rendered).toContain("data-decision-selector");
    expect(rendered).toContain("decision-matrix");
    expect(rendered).toContain("data-decision-column");
  });

  it("should carry a verdict as one signal, not a word and a glyph and a hue", () => {
    const { element } = render(twoOptions());
    const rendered = JSON.stringify(element);
    // The word is the signal that survives: it is the only one that is
    // meaningful without colour vision and readable without a legend.
    expect(rendered).toContain('"value":"Exact"');
    expect(rendered).toContain('"value":"Drifts"');
    // The comparison carries no glyphs and no tone hues at all; the single
    // remaining icon is the answered-record checkmark, which is not a verdict.
    const comparison = rendered.slice(
      rendered.indexOf("comparison-matrix"),
      rendered.indexOf("decision-zone-propose"),
    );
    expect(comparison).not.toContain("data-lucide");
    expect(rendered).not.toContain("matrix-tone-");
  });

  it("should separate every row option title from smaller criteria with bold labels and plain values", () => {
    const { element, diagnostics } = render(twoOptions(), undefined, "rows");
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(rendered).toContain(
      '"className":["text-lg","leading-7","font-semibold","text-ink"]',
    );
    expect(rendered.split("decision-row-head").length - 1).toBe(2);
    expect(rendered).toContain('"value":"Version fidelity:"');
    expect(rendered).toContain(
      '"className":["decision-row-dimension","font-semibold","text-ink"]',
    );
    expect(rendered).toContain(
      '"className":["decision-verdict","font-normal","text-ink"]',
    );
  });

  it("should separate the brief's framing sentence from its option list", () => {
    const { element, diagnostics } = render(twoOptions(), undefined, "brief");
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(rendered).toContain(
      '"className":["decision-brief-lead","m-0","border-b","border-edge","bg-surface","px-5","py-3.5"',
    );
    expect(rendered.indexOf("decision-brief-lead")).toBeLessThan(
      rendered.indexOf("decision-brief-list"),
    );
    expect(rendered).toContain("decision-details-chevron");
  });

  it.each([
    ["matrix-wide", "decision-matrix"],
    ["matrix-transposed", "decision-matrix-transposed"],
    ["matrix-keyed", "decision-matrix-keyed"],
  ])("should render the %s comparison experiment", (layout, marker) => {
    const { element, diagnostics } = render(twoOptions(), undefined, layout);
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(rendered).toContain(`"data-decision-layout":"${layout}"`);
    expect(rendered).toContain(marker);
    expect(rendered).toContain("data-decision-rationale");
  });

  it("should drop a criterion every option scores the same", () => {
    const shared = (verdict: string): ScopedChild =>
      consideration("Works offline", verdict, "good");
    const { element, diagnostics } = render([
      option({
        title: "Embedded",
        considerations: [consideration("Cost", "Low", "good"), shared("Yes")],
      }),
      option({
        title: "Download",
        considerations: [consideration("Cost", "High", "bad"), shared("Yes")],
      }),
    ]);
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    // Cost separates the options; "Works offline" cannot inform the choice.
    expect(rendered).toContain('"value":"Cost"');
    expect(rendered).not.toContain('"value":"Works offline"');
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
    expect(rendered).toContain("data-decision-proposal-cancel");
    expect(rendered).toContain('"value":"Cancel"');
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
