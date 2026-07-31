// Tests SimpleDecisionSet's compact static anatomy: numbered questions,
// option rows, recommended tags, and the question-count summary.

import { describe, expect, it } from "vitest";
import { compileMarkdown } from "../../render/markdown/compile-markdown.js";
import { serializeHtml } from "../../render/serialize-html.js";

const render = (markdown: string): string => {
  const { root } = compileMarkdown({ markdown });
  return serializeHtml({ root });
};

const QUESTION_SET = `<SimpleDecisionSet title="Open questions">

Answer these before implementation starts.

<SimpleDecision question="Ship behind a flag?">

The rollout risk is concentrated in the first week.

<Option title="Yes" recommended>

Keeps rollback one toggle away during the risky window.

</Option>

<Option title="No">

Avoids the flag-cleanup follow-up task.

</Option>

</SimpleDecision>

<SimpleDecision question="Rename the CLI now?">

<Option title="Now" />

<Option title="After launch" recommended />

</SimpleDecision>

</SimpleDecisionSet>
`;

describe("SimpleDecisionSet rendering", () => {
  it("should render the numbered question list with its count summary", () => {
    const html = render(QUESTION_SET);

    expect(html).toContain('data-simple-decision-set=""');
    expect(html).toContain("Open questions");
    expect(html).toContain("2 questions");
    expect(html).toContain("Answer these before implementation starts.");
    expect(html).toContain('id="simple-decision-set-open-questions"');
    expect(html).toContain(
      'id="simple-decision-set-open-questions-question-ship-behind-a-flag"',
    );
    expect(html).toContain(
      'id="simple-decision-set-open-questions-question-rename-the-cli-now"',
    );
    expect(html).toContain(">1.<");
    expect(html).toContain(">2.<");
  });

  it("should render option rows with details and recommended tags", () => {
    const html = render(QUESTION_SET);

    expect(html).toContain(
      'id="simple-decision-set-open-questions-question-ship-behind-a-flag-option-yes"',
    );
    expect(html).toContain('data-option-control=""');
    expect(html).toContain(
      'id="simple-decision-set-open-questions-question-ship-behind-a-flag-option-yes-title"',
    );
    expect(html).toContain(
      'id="simple-decision-set-open-questions-question-ship-behind-a-flag-option-yes-details"',
    );
    expect(html).toContain('data-option-description=""');
    expect(html).toContain("Keeps rollback one toggle away");
    const recommendedCount = html.split("badge-pill-quiet").length - 1;
    expect(recommendedCount).toBe(2);
    const optionCount = html.split('data-option=""').length - 1;
    expect(optionCount).toBe(4);
  });

  it("should render a singular count when the set has one question", () => {
    const html = render(
      '<SimpleDecisionSet>\n\n<SimpleDecision question="Q?">\n\n<Option title="A" />\n\n<Option title="B" />\n\n</SimpleDecision>\n\n</SimpleDecisionSet>\n',
    );
    expect(html).toContain("1 question");
    expect(html).not.toContain("1 questions");
  });

  it("should render no context block when a question has no body", () => {
    const html = render(
      '<SimpleDecisionSet>\n\n<SimpleDecision question="Q?">\n\n<Option title="A" />\n\n<Option title="B" />\n\n</SimpleDecision>\n\n</SimpleDecisionSet>\n',
    );
    const decisionCount = html.split('data-simple-decision=""').length - 1;
    expect(decisionCount).toBe(1);
  });
});
