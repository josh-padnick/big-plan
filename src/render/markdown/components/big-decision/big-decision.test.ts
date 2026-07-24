// Tests BigDecision's static HAST anatomy, state emphasis, native disclosure,
// and end-to-end rendering of the recursively scoped grammar.

import { describe, expect, it } from "vitest";
import { compileMarkdown, serializeMarkdown } from "../../convert.js";

const render = (markdown: string): string => {
  const { root } = compileMarkdown({ markdown });
  return serializeMarkdown({ root });
};

const OPEN_DECISION = `<BigDecision question="Which store?" status="open">

Context with a [link](https://example.com).

<Option title="PostgreSQL" recommended summary="Managed store.">

<Pro>
Mature **tooling**.
</Pro>

<Con>
Needs a server.
</Con>

Long detail with \`code\`.

</Option>

<Option title="SQLite" />

</BigDecision>
`;

const DECIDED_DECISION = `<BigDecision question="Which store?" status="decided">

<Option title="PostgreSQL" chosen summary="Managed store.">

<Pro>
Mature tooling.
</Pro>

</Option>

<Option title="SQLite" summary="Embedded database." />

</BigDecision>
`;

describe("BigDecision rendering", () => {
  it("should render the complete static anatomy when the decision is open", () => {
    const html = render(OPEN_DECISION);

    expect(html).toContain('data-big-decision=""');
    expect(html).toContain('data-decision-state="open"');
    expect(html).toContain('id="decision-which-store"');
    expect(html).toContain('data-decision-status="open"');
    expect(html).toContain("Which store?");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('id="option-postgresql"');
    expect(html).toContain('data-option-recommended=""');
    expect(html).toContain("Recommended");
    expect(html).toContain("Managed store.");
    expect(html).toContain('data-decision-tradeoff="pro"');
    expect(html).toContain('data-decision-tradeoff="con"');
    expect(html).toContain("<strong>tooling</strong>");
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
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

  it("should omit the details disclosure when an option has only tradeoffs", () => {
    const html = render(DECIDED_DECISION);
    expect(html).not.toContain("<details");
  });

  it("should render no summary paragraph when an option omits it", () => {
    const html = render(
      '<BigDecision question="Q?">\n\n<Option title="A" />\n\n<Option title="B" summary="Explains B." />\n\n</BigDecision>\n',
    );
    expect(html).toContain("Explains B.");
    const optionCount = html.split('data-option=""').length - 1;
    expect(optionCount).toBe(2);
  });

  it("should render the recommended pill exactly once per decision", () => {
    const html = render(OPEN_DECISION);
    const pillCount = html.split("big-decision-recommended-pill").length - 1;
    expect(pillCount).toBe(1);
  });
});
