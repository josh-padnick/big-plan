// Tests SmallDecisionSet's compact static anatomy: numbered questions,
// option rows, recommended tags, and the question-count summary.

import { describe, expect, it } from "vitest";
import { compileMarkdown, serializeMarkdown } from "../../convert.js";

const render = (markdown: string): string => {
  const { root } = compileMarkdown({ markdown });
  return serializeMarkdown({ root });
};

const QUESTION_SET = `<SmallDecisionSet title="Open questions">

Answer these before implementation starts.

<SmallDecision question="Ship behind a flag?">

The rollout risk is concentrated in the first week.

<Option title="Yes" recommended>

Keeps rollback one toggle away during the risky window.

</Option>

<Option title="No">

Avoids the flag-cleanup follow-up task.

</Option>

</SmallDecision>

<SmallDecision question="Rename the CLI now?">

<Option title="Now" />

<Option title="After launch" recommended />

</SmallDecision>

</SmallDecisionSet>
`;

describe("SmallDecisionSet rendering", () => {
  it("should render the numbered question list with its count summary", () => {
    const html = render(QUESTION_SET);

    expect(html).toContain('data-small-decision-set=""');
    expect(html).toContain("Open questions");
    expect(html).toContain("2 questions");
    expect(html).toContain("Answer these before implementation starts.");
    expect(html).toContain('id="question-ship-behind-a-flag"');
    expect(html).toContain('id="question-rename-the-cli-now"');
    expect(html).toContain(">1.<");
    expect(html).toContain(">2.<");
  });

  it("should render option rows with details and recommended tags", () => {
    const html = render(QUESTION_SET);

    expect(html).toContain('id="option-yes"');
    expect(html).toContain("Keeps rollback one toggle away");
    const recommendedCount =
      html.split("small-decision-recommended-pill").length - 1;
    expect(recommendedCount).toBe(2);
    const optionCount = html.split('data-option=""').length - 1;
    expect(optionCount).toBe(4);
  });

  it("should render a singular count when the set has one question", () => {
    const html = render(
      '<SmallDecisionSet>\n\n<SmallDecision question="Q?">\n\n<Option title="A" />\n\n<Option title="B" />\n\n</SmallDecision>\n\n</SmallDecisionSet>\n',
    );
    expect(html).toContain("1 question");
    expect(html).not.toContain("1 questions");
  });

  it("should render no context block when a question has no body", () => {
    const html = render(
      '<SmallDecisionSet>\n\n<SmallDecision question="Q?">\n\n<Option title="A" />\n\n<Option title="B" />\n\n</SmallDecision>\n\n</SmallDecisionSet>\n',
    );
    const decisionCount = html.split('data-small-decision=""').length - 1;
    expect(decisionCount).toBe(1);
  });
});
