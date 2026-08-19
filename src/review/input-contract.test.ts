// Proves the review's input contract enumerates what the plan asks, marks the
// author's critical questions, and reports an answer that stopped applying as
// stale rather than as one nobody gave.

import { describe, expect, it } from "vitest";
import { deriveDecisionInventory } from "./decision-inventory.js";
import { reviewInputs } from "./input-contract.js";
import type { StagedInputs } from "./plan-inputs-store.js";

const decision = ({
  question,
  critical,
}: {
  readonly question: string;
  readonly critical: boolean;
}): string => `<QuickDecision${critical ? " critical" : ""} question="${question}">
<Option title="Yes" recommended summary="Ship it." />
<Option title="No" summary="Hold it." />
</QuickDecision>
`;

const PLAN = `# Two questions

${decision({ question: "Do we ship behind a flag?", critical: true })}
${decision({ question: "Do we rename the endpoint?", critical: false })}
`;

const inventoryOf = (markdown: string) =>
  deriveDecisionInventory({ markdown, fallbackTitle: "plan" });

const NO_ANSWERS: StagedInputs = { version: 1, revision: 0, answers: [] };

const answerFor = ({
  markdown,
  question,
}: {
  readonly markdown: string;
  readonly question: string;
}) => {
  const entry = [...inventoryOf(markdown).values()].find(
    (candidate) => candidate.question === question,
  );
  if (entry === undefined) throw new Error(`No decision asks "${question}"`);
  const optionId = [...entry.optionIds].sort()[0];
  if (optionId === undefined) throw new Error("A decision offers no options");
  return {
    decisionId: entry.decisionId,
    optionId,
    optionTitle: "No",
    prompt: question,
    answeredAt: "2026-08-18T00:00:00.000Z",
    premiseSnapshot: "0123456789abcdef",
    decisionDigest: entry.decisionDigest,
  };
};

const contractOf = ({
  markdown,
  inputs,
}: {
  readonly markdown: string;
  readonly inputs: StagedInputs;
}) => reviewInputs({ inventory: inventoryOf(markdown), inputs });

describe("the review's decision inputs", () => {
  it("should list every decision the plan asks with its criticality", () => {
    expect(contractOf({ markdown: PLAN, inputs: NO_ANSWERS })).toEqual([
      {
        inputId: "quick-decision-do-we-ship-behind-a-flag",
        label: "Do we ship behind a flag?",
        isCritical: true,
        state: "unanswered",
        detail: "No answer recorded",
      },
      {
        inputId: "quick-decision-do-we-rename-the-endpoint",
        label: "Do we rename the endpoint?",
        isCritical: false,
        state: "unanswered",
        detail: "No answer recorded",
      },
    ]);
  });

  it("should report a recorded answer and name the option it chose", () => {
    const answer = answerFor({
      markdown: PLAN,
      question: "Do we rename the endpoint?",
    });

    const [, renamed] = contractOf({
      markdown: PLAN,
      inputs: { version: 1, revision: 1, answers: [answer] },
    });

    expect(renamed?.state).toBe("answered");
    expect(renamed?.detail).toBe("Answered: No");
  });

  it("should leave every other decision alone when one is rewritten", () => {
    const answers = [
      answerFor({ markdown: PLAN, question: "Do we ship behind a flag?" }),
      answerFor({ markdown: PLAN, question: "Do we rename the endpoint?" }),
    ];
    const reworded = PLAN.replace(
      "Do we rename the endpoint?",
      "Do we rename the endpoint before launch?",
    );

    const contract = contractOf({
      markdown: reworded,
      inputs: { version: 1, revision: 2, answers },
    });

    expect(contract.map((input) => [input.label, input.state])).toEqual([
      ["Do we ship behind a flag?", "answered"],
      ["Do we rename the endpoint before launch?", "unanswered"],
    ]);
  });

  it("should call exactly the edited decision's answer stale", () => {
    const answers = [
      answerFor({ markdown: PLAN, question: "Do we ship behind a flag?" }),
    ];
    const reworded = PLAN.replace("Ship it.", "Ship it behind a flag.");

    const [flagged] = contractOf({
      markdown: reworded,
      inputs: { version: 1, revision: 2, answers },
    });

    expect(flagged?.state).toBe("stale");
    expect(flagged?.detail).toBe("This decision changed after it was answered");
  });
});
