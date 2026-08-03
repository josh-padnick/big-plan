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

  it("should identify and explain the chosen option in a decided audit", () => {
    const html = render(
      analysis({
        interaction: "audit",
        scoring: ' scoring="weighted"',
        criterion: ' impact="5"',
        scoreA: ' score="5"',
        scoreB: ' score="4"',
      })
        .replace('state="proposed"', 'state="decided"')
        .replace('<Option title="SQLite">', '<Option title="SQLite" chosen>'),
    );

    expect(html).toContain("Chosen");
    expect(html).toContain('data-default-index="1"');
    expect(html).toContain('data-option-chosen=""');
    expect(html).toMatch(
      /<td class="decision-score-total[^>]+data-option-index="1"[^>]+data-option-chosen=""/,
    );
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

  it("should inventory criterion, option, cell, recommendation, and reversibility anchors", () => {
    const html = render(
      analysis({ interaction: "audit" })
        .replace(
          '<Criterion title="Integrity"',
          '<Criterion id="integrity" title="Integrity"',
        )
        .replace(
          '<Option title="PostgreSQL"',
          '<Option id="postgresql" title="PostgreSQL"',
        )
        .replace(
          '<Option title="SQLite"',
          '<Option id="sqlite" title="SQLite"',
        ),
    );

    expect(html).toContain(
      'data-decision-anchor="component/DecisionAnalysis#1/criterion/integrity"',
    );
    expect(html).toContain(
      'data-decision-anchor="component/DecisionAnalysis#1/option/postgresql"',
    );
    expect(html).toContain(
      'data-decision-anchor="component/DecisionAnalysis#1/cell/postgresql/integrity"',
    );
    expect(html).toContain(
      'data-decision-anchor="component/DecisionAnalysis#1/recommendation"',
    );
    expect(html).toContain(
      'data-decision-anchor="component/DecisionAnalysis#1/reversibility"',
    );
  });
});
