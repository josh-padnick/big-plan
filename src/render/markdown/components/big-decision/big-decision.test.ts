// Tests BigDecision's static matrix anatomy, state emphasis, info
// disclosures, and end-to-end rendering of the criteria grammar.

import { describe, expect, it } from "vitest";
import { compileMarkdown, serializeMarkdown } from "../../convert.js";

const render = (markdown: string): string => {
  const { root } = compileMarkdown({ markdown });
  return serializeMarkdown({ root });
};

const OPEN_DECISION = `<BigDecision question="Which store?" status="open">

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

<Reversibility rating="easy">

Cheap to change later.

</Reversibility>

</BigDecision>
`;

const DECIDED_DECISION = `<BigDecision question="Which store?" status="decided">

<Option title="PostgreSQL" chosen summary="The team already runs it." />

<Option title="SQLite" summary="Embedded database." />

</BigDecision>
`;

describe("BigDecision rendering", () => {
  it("should render the complete matrix anatomy when criteria are declared", () => {
    const html = render(OPEN_DECISION);

    expect(html).toContain('data-big-decision=""');
    expect(html).toContain('data-decision-state="open"');
    expect(html).toContain('id="decision-which-store"');
    expect(html).toContain('data-decision-status="open"');
    expect(html).toContain('data-decision-question=""');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('data-decision-reversibility=""');
    expect(html).toContain('data-reversibility-rating="easy"');
    expect(html).toContain("Easy to reverse");
    expect(html).toContain("Cheap to change later.");
    expect(html).toContain("Reversibility is what it would cost");
    expect(html).toContain("<table");
    expect(html).toContain('id="criterion-setup"');
    expect(html).toContain('id="criterion-scale"');
    expect(html).toContain('id="option-postgresql"');
    expect(html).toContain('data-option-recommended=""');
    expect(html).toContain("Recommended");
    expect(html).toContain('data-score-tone="bad"');
    expect(html).toContain('data-score-tone="good"');
    expect(html).toContain('data-score-tone="mixed"');
    expect(html).toContain("Needs a server");
    expect(html).toContain('data-lucide="x"');
    expect(html).toContain('data-lucide="undo-2"');
    expect(html).toContain('data-decision-expand=""');
    expect(html).toContain('data-lucide="maximize-2"');
    expect(html).toContain("<strong>writers</strong>");
    expect(html).toContain("big-decision-info");
    expect(html).toContain("big-decision-criterion-help");
    expect(html).toContain('data-lucide="circle-question-mark"');
    expect(html).toContain("Why setup matters here.");
    expect(html).toContain("PostgreSQL details");
    expect(html).toContain("<code>code</code>");
    expect(html).not.toContain("data-decision-outcome");
  });

  it("should render the outcome strip and mute losing options when decided", () => {
    const html = render(DECIDED_DECISION);

    expect(html).toContain('data-decision-outcome=""');
    expect(html).toContain("Chosen: PostgreSQL");
    expect(html).toContain('data-option-chosen=""');
    expect(html).toContain("big-decision-option-muted");
    expect(html).toContain("big-decision-option-marker-chosen");
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
    expect(html).not.toContain("big-decision-info");
    expect(html).not.toContain("<details");
  });

  it("should render the recommended pill exactly once per decision", () => {
    const html = render(OPEN_DECISION);
    const pillCount = html.split("big-decision-recommended-pill").length - 1;
    expect(pillCount).toBe(1);
  });
});
