// Derives the review's input contract: every input the plan expects, its
// criticality, and whether the reviewer has met it.
//
// The derivation lives on the server because both of its halves already do.
// The runtime compiles the plan, so it alone knows which decisions are asked
// and which of them the author marked critical the moment the source changes;
// it also holds the two records the reviewer's work goes into. A browser
// joining those from its own memory would be reconstructing, on every page,
// the answer the runtime already has - and would disagree with the next
// browser the moment the plan moved underneath one of them.
//
// Nothing here writes. The contract is a read over inert data, so it needs no
// reconciliation, no pruning, and no retry: change the plan, ask again, and the
// answer is different because the inputs are.

import {
  changeSetStanding,
  acceptedChangeKeys,
  type ChangeDispositionState,
} from "./shared/change-disposition.js";
import { isCurrentAnswer, type StagedInputs } from "./plan-inputs-store.js";
import type { DecisionInventory } from "./decision-inventory.js";
import type { ReviewInput } from "./shared/input-contract.js";

/** One change set as the contract needs to see it. */
export type ChangeSetInput = {
  readonly changeSetId: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  /** The places this revision changed, or none where its snapshots are gone. */
  readonly placeIds: ReadonlyArray<string>;
};

const decisionDetail = ({
  state,
  optionTitle,
}: {
  readonly state: ReviewInput["state"];
  readonly optionTitle: string | undefined;
}): string => {
  if (state === "answered" && optionTitle !== undefined) {
    return `Answered: ${optionTitle}`;
  }
  if (state === "stale") {
    return "This decision changed after it was answered";
  }
  return "No answer recorded";
};

/**
 * Projects the decisions the plan asks into contract inputs.
 *
 * The three states come from the answers store's own currency predicate rather
 * than a second reading of it, so a decision the reviewer answered and then
 * saw reworded reports stale here for exactly the reason the card says so.
 */
export const decisionInputs = ({
  inventory,
  inputs,
}: {
  readonly inventory: DecisionInventory;
  readonly inputs: StagedInputs;
}): ReadonlyArray<ReviewInput> =>
  [...inventory.values()].map((entry) => {
    const stored = inputs.answers.find(
      (answer) => answer.decisionId === entry.decisionId,
    );
    const state: ReviewInput["state"] =
      stored === undefined
        ? "unanswered"
        : isCurrentAnswer({ answer: stored, inventory })
          ? "answered"
          : "stale";
    return {
      inputId: entry.decisionId,
      kind: "decision",
      label: entry.question,
      isCritical: entry.isCritical,
      state,
      detail: decisionDetail({ state, optionTitle: stored?.optionTitle }),
    };
  });

/**
 * Projects the change sets an agent published into contract inputs.
 *
 * A disposition names the two snapshot digests it closed, so acceptance
 * recorded against an earlier result cannot count toward the change set's
 * current one. That is what makes a change set that moved under recorded
 * acceptances stale rather than merely unanswered: the reviewer closed this
 * change set once, and a later revision reopened it.
 */
export const changeSetInputs = ({
  changeSets,
  dispositions,
}: {
  readonly changeSets: ReadonlyArray<ChangeSetInput>;
  readonly dispositions: ChangeDispositionState;
}): ReadonlyArray<ReviewInput> => {
  const accepted = acceptedChangeKeys(dispositions);
  return changeSets.map((changeSet) => {
    const standing = changeSetStanding({
      from: changeSet.from,
      to: changeSet.to,
      placeIds: changeSet.placeIds,
      accepted,
    });
    const supersededAcceptance = dispositions.accepted.some(
      (entry) => entry.from === changeSet.from && entry.to !== changeSet.to,
    );
    const state: ReviewInput["state"] = standing.isAccepted
      ? "answered"
      : supersededAcceptance
        ? "stale"
        : "unanswered";
    return {
      inputId: changeSet.changeSetId,
      kind: "change-set",
      label: changeSet.label,
      isCritical: false,
      state,
      detail:
        standing.total === 0
          ? "These changes are no longer available to review"
          : state === "stale"
            ? `Revised after review; ${standing.accepted} of ${standing.total} changes accepted`
            : `${standing.accepted} of ${standing.total} changes accepted`,
    };
  });
};

/**
 * The whole contract, decisions first.
 *
 * Decisions lead because they are the plan's own questions and the only inputs
 * an author can call critical; change sets are what the conversation added to
 * it. A reader scanning for what is blocking approval meets the blocking kind
 * first.
 */
export const reviewInputs = ({
  inventory,
  inputs,
  changeSets,
  dispositions,
}: {
  readonly inventory: DecisionInventory;
  readonly inputs: StagedInputs;
  readonly changeSets: ReadonlyArray<ChangeSetInput>;
  readonly dispositions: ChangeDispositionState;
}): ReadonlyArray<ReviewInput> => [
  ...decisionInputs({ inventory, inputs }),
  ...changeSetInputs({ changeSets, dispositions }),
];
