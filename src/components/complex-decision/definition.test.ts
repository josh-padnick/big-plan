// Tests ComplexDecision's static matrix anatomy, state emphasis, info
// disclosures, and end-to-end rendering of the criteria grammar.

import { describe, expect, it } from "vitest";
import { compileMarkdown } from "../../render/markdown/compile-markdown.js";
import { serializeHtml } from "../../render/serialize-html.js";

const render = (markdown: string): string => {
  const { root } = compileMarkdown({ markdown });
  return serializeHtml({ root });
};

const OPEN_DECISION = `<ComplexDecision question="Which store?" status="open">

Context with a [link](https://example.com).

<Criterion title="Setup">

Why setup matters here.

</Criterion>

<Criterion title="Scale" />

<Option title="PostgreSQL" recommended summary="The team already runs it.">

<Score criterion="Setup" verdict="Needs a server" tone="bad" />

<Score criterion="Scale" verdict="Ready" tone="good">

Concurrent **writers** work today.

</Score>

Long detail with \`code\`.

</Option>

<Option title="SQLite">

<Score criterion="Setup" verdict="Zero setup" tone="good" />

<Score criterion="Scale" verdict="Single writer" tone="mixed" />

</Option>

<Details>

Question-level long form.

</Details>

<Reversibility rating="easy">

Cheap to change later.

</Reversibility>

</ComplexDecision>
`;

const DECIDED_DECISION = `<ComplexDecision question="Which store?" status="decided">

<Option title="PostgreSQL" chosen summary="The team already runs it." />

<Option title="SQLite" summary="Embedded database." />

</ComplexDecision>
`;

describe("ComplexDecision rendering", () => {
  it("should render the complete matrix anatomy when criteria are declared", () => {
    const html = render(OPEN_DECISION);

    expect(html).toContain('data-complex-decision=""');
    expect(html).toContain('data-decision-state="open"');
    expect(html).toContain('id="decision-which-store"');
    expect(html).not.toContain('data-decision-status="open"');
    expect(html).toContain('data-decision-question=""');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('data-decision-reversibility=""');
    expect(html).toContain('data-reversibility-rating="easy"');
    expect(html).toContain("Easy to reverse");
    expect(html).toContain("Cheap to change later.");
    expect(html).toContain("Reversibility is what it would cost");
    expect(html).toContain("<table");
    expect(html.split("data-table-scroll-container").length - 1).toBe(1);
    expect(html).toContain('id="decision-which-store-criterion-setup"');
    expect(html).toContain('id="decision-which-store-criterion-scale"');
    expect(html).toContain('id="decision-which-store-option-postgresql"');
    expect(html).toContain('data-option-control=""');
    expect(html).toContain('id="decision-which-store-option-postgresql-title"');
    expect(html).toContain(
      'id="decision-which-store-option-postgresql-summary"',
    );
    expect(html).toContain(
      'id="decision-which-store-option-postgresql-details"',
    );
    expect(html).toContain('data-option-description=""');
    expect(html).toContain('data-option-recommended=""');
    expect(html).toContain("Recommended");
    expect(html).toContain('data-score-tone="bad"');
    expect(html).toContain('data-score-tone="good"');
    expect(html).toContain('data-score-tone="mixed"');
    expect(html).toContain('<span class="sr-only">Tone: bad.</span>');
    expect(html).toContain('<span class="sr-only">Tone: good.</span>');
    expect(html).toContain('<span class="sr-only">Tone: mixed.</span>');
    expect(html).toContain("Needs a server");
    expect(html).toContain('data-lucide="x"');
    expect(html).toContain('data-lucide="undo-2"');
    expect(html).toContain('data-decision-expand=""');
    expect(html).toContain('data-lucide="maximize-2"');
    expect(html).toContain("<strong>writers</strong>");
    expect(html).toContain("complex-decision-info");
    expect(html).toContain("complex-decision-criterion-help");
    expect(html).toContain('data-lucide="circle-question-mark"');
    expect(html).toContain('data-lucide="info"');
    expect(html).toContain("Why setup matters here.");
    expect(html).toContain(
      'data-option-details="decision-which-store-option-postgresql"',
    );
    expect(html).toContain('data-decision-details=""');
    expect(html).toContain("Question-level long form.");
    expect(html).toContain('data-option-decorators=""');
    expect(html).toContain("<code>code</code>");
    expect(html).not.toContain("data-decision-outcome");
  });

  it("should render the outcome strip and mute losing options when decided", () => {
    const html = render(DECIDED_DECISION);

    expect(html).toContain('data-decision-outcome=""');
    expect(html).toContain("Chosen: PostgreSQL");
    expect(html).toContain('data-option-chosen=""');
    expect(html).toContain("complex-decision-option-muted");
    expect(html).toContain("complex-decision-option-marker-chosen");
    expect(html).toContain("Embedded database.");
  });

  it("should render a stacked fallback when no criteria are declared", () => {
    const html = render(DECIDED_DECISION);
    expect(html).not.toContain("<table");
    const optionCount = html.split('data-option=""').length - 1;
    expect(optionCount).toBe(2);
  });

  it("should omit info disclosures when a score has no body", () => {
    const html = render(DECIDED_DECISION);
    expect(html).not.toContain("complex-decision-info");
    expect(html).not.toContain("<details");
  });

  // The summary's own text-muted utility beats a components-layer rule, so the
  // open accent rides a group variant. Criterion help stays out of the group
  // deliberately: its title keeps the surrounding row color when it opens.
  it("should accent an open info disclosure without recoloring criterion help", () => {
    const html = render(OPEN_DECISION);

    expect(html).toContain("group-open:text-accent");
    expect(html).toContain("complex-decision-criterion-help");
    expect(html).not.toContain("complex-decision-criterion-help group");
  });

  it("should render the recommended pill exactly once per decision", () => {
    const html = render(OPEN_DECISION);
    const pillCount =
      html.split("complex-decision-recommended-pill").length - 1;
    expect(pillCount).toBe(1);
  });
});
