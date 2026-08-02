// Tests Decision's authored contract and the three approved reading depths.

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

const paragraph = (value: string): Element => ({
  type: "element",
  tagName: "p",
  properties: {},
  children: [{ type: "text", value }],
  position: POSITION,
});

const criterion = (
  title: string,
  detail = `Defines what ${title.toLowerCase()} measures.`,
): ScopedChild => ({
  name: "Criterion",
  attributes: { title },
  children: [paragraph(detail)],
  position: POSITION,
});

const consideration = (
  criterionTitle: string,
  verdict: string,
  tone?: string,
  detail = `${verdict} holds because the option has this property.`,
): ScopedChild => ({
  name: "Consideration",
  attributes: {
    criterion: criterionTitle,
    verdict,
    ...(tone === undefined ? {} : { tone }),
  },
  children: [paragraph(detail)],
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
  if (parsed === undefined) throw new Error("component rendered no element");
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
  criterion(
    "Version fidelity",
    "Whether delivered guidance exactly matches the installed version.",
  ),
  option({
    title: "Embedded",
    summary: "Ships with the command.",
    recommended: true,
    considerations: [
      consideration(
        "Version fidelity",
        "Exact",
        "good",
        "The guidance is compiled into the installed command.",
      ),
    ],
  }),
  option({
    title: "Download",
    summary: "Ships as a separate file.",
    chosen,
    considerations: [
      consideration(
        "Version fidelity",
        "Drifts",
        "bad",
        "The download can change independently of the installed command.",
      ),
    ],
  }),
];

describe("DECISION_COMPONENT_DEFINITION", () => {
  it("should render the keyed chooser matrix with definitions on criteria and values", () => {
    const { element, diagnostics } = render(twoOptions());
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(rendered).toContain("decision-keyed-chooser");
    expect(rendered).toContain("decision-matrix-keyed");
    expect(rendered).toContain('"value":"A"');
    expect(rendered).toContain('"value":"B"');
    expect(rendered).toContain('"data-decision-definition":"criterion"');
    expect(
      rendered.split('"data-decision-definition":"value"').length - 1,
    ).toBe(2);
    expect(rendered).toContain("data-info-popover-body");
    expect(rendered).toContain(
      '"value":"Whether delivered guidance exactly matches the installed version."',
    );
    expect(rendered).toContain(
      '"value":"The guidance is compiled into the installed command."',
    );
  });

  it("should carry each verdict as one underlined text signal", () => {
    const { element } = render(twoOptions());
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"value":"Exact"');
    expect(rendered).toContain('"value":"Drifts"');
    const comparison = rendered.slice(
      rendered.indexOf("decision-matrix-keyed"),
      rendered.indexOf("decision-zone-rationale"),
    );
    expect(comparison).not.toContain("data-lucide");
    expect(rendered).not.toContain("matrix-tone-");
  });

  it("should preserve the approved row hierarchy", () => {
    const { element, diagnostics } = render(twoOptions(), undefined, "rows");
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(rendered.split("decision-row-head").length - 1).toBe(2);
    expect(rendered).toContain('"value":"Version fidelity:"');
    expect(rendered).toContain(
      '"className":["decision-row-dimension","font-semibold","text-ink"]',
    );
    expect(rendered).toContain(
      '"className":["decision-verdict","font-normal","text-ink"]',
    );
    expect(rendered).not.toContain("data-decision-definition");
  });

  it("should preserve the approved brief framing and collapsed comparison", () => {
    const { element, diagnostics } = render(twoOptions(), undefined, "brief");
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(rendered.indexOf("decision-brief-lead")).toBeLessThan(
      rendered.indexOf("decision-brief-list"),
    );
    expect(rendered).toContain("decision-details-chevron");
    expect(rendered).not.toContain("data-decision-definition");
  });

  it("should drop a criterion every option scores the same", () => {
    const children = [
      criterion("Cost"),
      criterion("Works offline"),
      option({
        title: "Embedded",
        considerations: [
          consideration("Cost", "Low"),
          consideration("Works offline", "Yes"),
        ],
      }),
      option({
        title: "Download",
        considerations: [
          consideration("Cost", "High"),
          consideration("Works offline", "Yes"),
        ],
      }),
    ];
    const { element, diagnostics } = render(children);
    expect(diagnostics).toEqual([]);
    const rendered = JSON.stringify(element);
    expect(rendered).toContain('"value":"Cost"');
    expect(rendered).not.toContain('"value":"Works offline"');
  });

  it("should require a criterion definition and value reason", () => {
    const emptyCriterion = {
      ...criterion("Cost"),
      children: [],
    };
    const emptyReason = {
      ...consideration("Cost", "Low"),
      children: [],
    };
    const { diagnostics } = render([
      emptyCriterion,
      option({ title: "A", considerations: [emptyReason] }),
      option({
        title: "B",
        considerations: [consideration("Cost", "High")],
      }),
    ]);
    expect(diagnostics.map(({ message }) => message)).toContain(
      "A Decision Criterion needs one prose sentence explaining what it means",
    );
    expect(diagnostics.map(({ message }) => message)).toContain(
      "A Decision Consideration needs one prose sentence explaining why its verdict holds",
    );
  });

  it("should limit definitions and reasons to one sentence", () => {
    const { diagnostics } = render([
      criterion("Cost", "The implementation cost. It includes maintenance."),
      option({
        title: "A",
        considerations: [
          consideration("Cost", "Low", undefined, "It reuses code. No fork."),
        ],
      }),
      option({
        title: "B",
        considerations: [consideration("Cost", "High")],
      }),
    ]);
    expect(diagnostics.map(({ message }) => message)).toContain(
      "A Decision Criterion explanation must be one sentence at most",
    );
    expect(diagnostics.map(({ message }) => message)).toContain(
      "A Decision Consideration explanation must be one sentence at most",
    );
  });

  it("should diagnose unknown, duplicate, and missing criterion values", () => {
    const { diagnostics } = render([
      criterion("Cost"),
      option({
        title: "A",
        considerations: [
          consideration("Other", "Low"),
          consideration("Other", "High"),
        ],
      }),
      option({ title: "B", considerations: [consideration("Cost", "High")] }),
    ]);
    expect(diagnostics.map(({ message }) => message)).toContain(
      'Consideration references unknown criterion "Other"',
    );
    expect(diagnostics.map(({ message }) => message)).toContain(
      'Option "A" needs a Consideration for criterion "Cost"',
    );
  });

  it("should reject duplicate criterion and option titles", () => {
    const { diagnostics } = render([
      criterion("Cost"),
      criterion("Cost"),
      option({
        title: "A",
        considerations: [consideration("Cost", "Low")],
      }),
      option({
        title: "A",
        considerations: [consideration("Cost", "High")],
      }),
    ]);
    expect(diagnostics.map(({ message }) => message)).toContain(
      'Duplicate Criterion title "Cost" in Decision',
    );
    expect(diagnostics.map(({ message }) => message)).toContain(
      'Duplicate Option title "A" in Decision',
    );
  });

  it("should reject a verdict too long to scan", () => {
    const { diagnostics } = render([
      criterion("Cost"),
      option({
        title: "A",
        considerations: [consideration("Cost", "Low once the cache warms up")],
      }),
      option({
        title: "B",
        considerations: [consideration("Cost", "High")],
      }),
    ]);
    expect(diagnostics.map(({ message }) => message)).toContain(
      "A Consideration verdict must be at most 24 characters so options stay scannable; move the reasoning into the Consideration body",
    );
  });

  it("should enforce option count, recommendation, and settled-state rules", () => {
    const one = render([
      criterion("Cost"),
      option({
        title: "A",
        considerations: [consideration("Cost", "Low")],
      }),
    ]);
    expect(one.diagnostics.map(({ message }) => message)).toContain(
      "Decision must contain at least two Options",
    );

    const recommended = render([
      criterion("Cost"),
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
    expect(recommended.diagnostics.map(({ message }) => message)).toContain(
      "Decision cannot contain more than one recommended Option",
    );

    const unsettled = render(twoOptions({ chosen: true }));
    expect(unsettled.diagnostics.map(({ message }) => message)).toContain(
      'A Decision with a chosen Option must set status="decided"',
    );
    const unchosen = render(twoOptions(), "decided");
    expect(unchosen.diagnostics.map(({ message }) => message)).toContain(
      'A Decision with status="decided" must mark one Option chosen',
    );
  });

  it("should keep the proposal reachable without script and cancellable", () => {
    const { element } = render(twoOptions());
    const rendered = JSON.stringify(element);
    const field = rendered.slice(rendered.indexOf('data-decision-proposal"'));
    expect(field.slice(0, 200)).not.toContain('"hidden":true');
    expect(rendered).toContain("data-decision-proposal-cancel");
    expect(rendered).toContain('"value":"Cancel"');
  });
});
