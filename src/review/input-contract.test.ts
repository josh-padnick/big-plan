// Proves the review's input contract enumerates what the plan asks, marks the
// author's critical questions, and reports an answer that stopped applying as
// stale rather than as one nobody gave.

import { describe, expect, it } from "vitest";
import { deriveDecisionInventory } from "./decision-inventory.js";
import { changeSetInputs, reviewInputs } from "./input-contract.js";
import type { ChangeSetPlaces } from "./input-contract.js";
import type { StagedInputs } from "./plan-inputs-store.js";
import type { ChangeDispositionState } from "./shared/change-disposition.js";

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
const NO_DISPOSITIONS: ChangeDispositionState = { accepted: [], revision: 0 };

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
}) =>
  reviewInputs({
    inventory: inventoryOf(markdown),
    inputs,
    changeSets: [],
    dispositions: NO_DISPOSITIONS,
  });

describe("the review's decision inputs", () => {
  it("should list every decision the plan asks with its criticality", () => {
    expect(contractOf({ markdown: PLAN, inputs: NO_ANSWERS })).toEqual([
      {
        inputId: "quick-decision-do-we-ship-behind-a-flag",
        kind: "decision",
        label: "Do we ship behind a flag?",
        isCritical: true,
        state: "unanswered",
        detail: "No answer recorded",
      },
      {
        inputId: "quick-decision-do-we-rename-the-endpoint",
        kind: "decision",
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

const PLACE_IDS = ["place-one", "place-two"];

const CHANGE_SET = {
  changeSetId: "abc1",
  label: "Name the rollback owner",
  from: "1111111111111111",
  to: "2222222222222222",
  priorResultSnapshots: [] as ReadonlyArray<string>,
  places: { kind: "known", placeIds: PLACE_IDS } as ChangeSetPlaces,
};

const acceptedAt = ({
  from,
  to,
  placeIds,
}: {
  readonly from: string;
  readonly to: string;
  readonly placeIds: ReadonlyArray<string>;
}) =>
  placeIds.map((placeId) => ({
    from,
    to,
    placeId,
    acceptedAt: "2026-08-18T00:00:00.000Z",
  }));

describe("the review's change-set inputs", () => {
  it("should report how much of one change set the reviewer closed", () => {
    expect(
      changeSetInputs({
        changeSets: [CHANGE_SET],
        dispositions: {
          revision: 1,
          accepted: [
            {
              from: CHANGE_SET.from,
              to: CHANGE_SET.to,
              placeId: "place-one",
              acceptedAt: "2026-08-18T00:00:00.000Z",
            },
          ],
        },
      }),
    ).toEqual([
      {
        inputId: "abc1",
        kind: "change-set",
        label: "Name the rollback owner",
        isCritical: false,
        state: "unanswered",
        detail: "1 of 2 changes accepted",
      },
    ]);
  });

  it("should answer a change set only once every place is accepted", () => {
    expect(
      changeSetInputs({
        changeSets: [CHANGE_SET],
        dispositions: {
          revision: 2,
          accepted: acceptedAt({
            from: CHANGE_SET.from,
            to: CHANGE_SET.to,
            placeIds: PLACE_IDS,
          }),
        },
      })[0]?.state,
    ).toBe("answered");
  });

  it("should call a change set stale when a later revision reopened it", () => {
    const [revised] = changeSetInputs({
      changeSets: [
        {
          ...CHANGE_SET,
          to: "3333333333333333",
          priorResultSnapshots: [CHANGE_SET.to],
        },
      ],
      dispositions: {
        revision: 3,
        accepted: acceptedAt({
          from: CHANGE_SET.from,
          to: CHANGE_SET.to,
          placeIds: PLACE_IDS,
        }),
      },
    });

    expect(revised?.state).toBe("stale");
    expect(revised?.detail).toBe(
      "Revised after review; 0 of 2 changes accepted",
    );
  });

  // One feedback response answering two comments commits one revision that
  // carries both change sets, so both are based on the same snapshot. Reading
  // that shared base as identity called the untouched sibling stale.
  it("should leave a sibling nobody revised out of the stale reading", () => {
    const FIRST_RESULT = "2222222222222222";
    const SECOND_RESULT = "3333333333333333";
    const revised = {
      ...CHANGE_SET,
      changeSetId: "aaaa",
      label: "Name the rollback owner",
      to: SECOND_RESULT,
      priorResultSnapshots: [FIRST_RESULT],
      places: {
        kind: "known",
        placeIds: ["place-three"],
      } as ChangeSetPlaces,
    };
    const sibling = {
      ...CHANGE_SET,
      changeSetId: "bbbb",
      label: "State the rollout window",
      to: FIRST_RESULT,
      priorResultSnapshots: [],
    };

    const inputs = changeSetInputs({
      changeSets: [revised, sibling],
      dispositions: {
        revision: 4,
        accepted: acceptedAt({
          from: CHANGE_SET.from,
          to: SECOND_RESULT,
          placeIds: ["place-three"],
        }),
      },
    });

    expect(inputs.map((input) => [input.label, input.state])).toEqual([
      ["Name the rollback owner", "answered"],
      ["State the rollout window", "unanswered"],
    ]);
  });

  it("should keep a change set whose snapshots are gone in the contract", () => {
    expect(
      changeSetInputs({
        changeSets: [{ ...CHANGE_SET, places: { kind: "unreadable" } }],
        dispositions: NO_DISPOSITIONS,
      })[0],
    ).toMatchObject({
      state: "unanswered",
      detail: "These changes are no longer available to review",
    });
  });

  // A chat answer and a declined outcome both commit a revision that edited
  // nothing. Listing one would put a row in front of the reviewer that no
  // gesture of theirs could ever satisfy.
  it("should leave a revision that changed nothing out of the contract", () => {
    expect(
      changeSetInputs({
        changeSets: [
          { ...CHANGE_SET, places: { kind: "known", placeIds: [] } },
        ],
        dispositions: NO_DISPOSITIONS,
      }),
    ).toEqual([]);
  });
});
