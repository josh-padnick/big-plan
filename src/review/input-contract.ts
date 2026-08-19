// Derives the review's input contract: every input the plan expects, its
// criticality, and whether the reviewer has met it.
//
// The derivation lives on the server because both of its halves already do.
// The runtime compiles the plan, so it alone knows which decisions are asked
// and which of them the author marked critical the moment the source changes;
// it also holds the record the reviewer's answers go into. A browser joining
// those from its own memory would be reconstructing, on every page, the answer
// the runtime already has - and would disagree with the next browser the
// moment the plan moved underneath one of them.
//
// Nothing here writes. The contract is a read over inert data, so it needs no
// reconciliation, no pruning, and no retry: change the plan, ask again, and the
// answer is different because the inputs are.

import { isCurrentAnswer, type StagedInputs } from "./plan-inputs-store.js";
import type { DecisionInventory } from "./decision-inventory.js";
import type { ReviewInput } from "./shared/input-contract.js";

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
 * Projects the decisions the plan asks into the contract's inputs.
 *
 * The three states come from the answers store's own currency predicate rather
 * than a second reading of it, so a decision the reviewer answered and then
 * saw reworded reports stale here for exactly the reason the card says so.
 */
export const reviewInputs = ({
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
      label: entry.question,
      isCritical: entry.isCritical,
      state,
      detail: decisionDetail({ state, optionTitle: stored?.optionTitle }),
    };
  });
