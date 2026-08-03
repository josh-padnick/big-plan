// Tests DecisionAnalysis's audit, choice, and weighted-scoring contracts.

import { describe, expect, it } from "vitest";
import {
  MarkdownDiagnosticsError,
  renderDocument,
} from "../../render/render-document.js";

const render = (markdown: string): string =>
  renderDocument({ markdown, fallbackTitle: "Decision analysis" }).html;

const analysis = ({
  interaction,
  scoring = "",
  criterion = "",
  scoreA = "",
  scoreB = "",
}: {
  readonly interaction: "audit" | "choose";
  readonly scoring?: string;
  readonly criterion?: string;
  readonly scoreA?: string;
  readonly scoreB?: string;
}) => `<DecisionAnalysis question="Which store?" state="proposed" interaction="${interaction}"${scoring}>

<Criterion title="Integrity"${criterion}>

How safely related records commit together.

</Criterion>

<Option title="PostgreSQL" recommended>

<Score criterion="Integrity" verdict="Strong" tone="good"${scoreA}>

Transactions preserve the records atomically.

</Score>

</Option>

<Option title="SQLite">

<Score criterion="Integrity" verdict="Good" tone="good"${scoreB}>

A local transaction protects each write.

</Score>

</Option>

<Reversibility rating="somewhat-hard">

Changing stores requires a data migration.

</Reversibility>

</DecisionAnalysis>`;

describe("DecisionAnalysis", () => {
  it("should render qualitative audit evidence without answer controls", () => {
    const html = render(analysis({ interaction: "audit" }));

    expect(html).toContain("decision-matrix-keyed");
    expect(html).toContain('data-decision-interaction="audit"');
    expect(html).not.toContain('data-decision-confirm=""');
    expect(html).toContain("decision-definition-trigger");
  });

  it("should render weighted impacts, stars, totals, and calculation matrix", () => {
    const html = render(
      analysis({
        interaction: "choose",
        scoring: ' scoring="weighted"',
        criterion: ' impact="5"',
        scoreA: ' score="5"',
        scoreB: ' score="4"',
      }),
    );

    expect(html).toContain("data-decision-weight-group");
    expect(html).toContain("data-decision-score-group");
    expect(html).toContain("Total score");
    expect(html).toContain("decision-calculation-matrix");
  });

  it("should reject choose mode after a decision is settled", () => {
    expect(() =>
      render(
        analysis({ interaction: "choose" }).replace(
          'state="proposed"',
          'state="decided"',
        ),
      ),
    ).toThrow(MarkdownDiagnosticsError);
  });
});
