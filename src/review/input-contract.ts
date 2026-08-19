// Derives the review's input contract: every input the review expects, its
// criticality, and whether the reviewer has met it.
//
// The derivation lives on the server because its sources already do. The
// runtime compiles the plan, so it alone knows which decisions are asked and
// which of them the author marked critical the moment the source changes. It
// also owns the published change-set inventory and the two records the
// reviewer's work goes into. A browser joining those from its own memory would
// be reconstructing, on every page, the answer the runtime already has - and
// would disagree with the next browser the moment the plan moved underneath
// one of them.
//
// Nothing here writes. The contract is a read over inert data, so it needs no
// reconciliation, no pruning, and no retry: change the plan, ask again, and the
// answer is different because the inputs are.

import {
  acceptedChangeKeys,
  changeSetStanding,
  type ChangeDispositionState,
} from "./shared/change-disposition.js";
import { isCurrentAnswer, type StagedInputs } from "./plan-inputs-store.js";
import type { DecisionInventory } from "./decision-inventory.js";
import type { ReviewInput } from "./shared/input-contract.js";

/**
 * What one revision changed, or the fact that nobody can say any more.
 *
 * A diff that came out empty and a diff that could not be computed are
 * different facts about a change set. A revision that edited nothing asks the
 * reviewer for nothing, while a revision whose snapshots are gone asks for
 * something the review can no longer show.
 */
export type ChangeSetPlaces =
  | { readonly kind: "known"; readonly placeIds: ReadonlyArray<string> }
  | { readonly kind: "unreadable" };

/** One change set as the contract needs to see it. */
export type ChangeSetInput = {
  readonly changeSetId: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly places: ChangeSetPlaces;
  /** The results this change set held before its current one. */
  readonly priorResultSnapshots: ReadonlyArray<string>;
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
 * Projects the decisions the plan asks into the contract's inputs.
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
 * acceptances stale rather than merely unanswered.
 *
 * Supersession is asked of the addresses this change set has itself occupied,
 * never of its shared base. A revision that changed nothing is not an input,
 * while one whose snapshots are unavailable remains visible as unreadable.
 */
export const changeSetInputs = ({
  changeSets,
  dispositions,
}: {
  readonly changeSets: ReadonlyArray<ChangeSetInput>;
  readonly dispositions: ChangeDispositionState;
}): ReadonlyArray<ReviewInput> => {
  const accepted = acceptedChangeKeys(dispositions);
  const inputs: Array<ReviewInput> = [];
  for (const changeSet of changeSets) {
    const isReadable = changeSet.places.kind === "known";
    const placeIds =
      changeSet.places.kind === "known" ? changeSet.places.placeIds : [];
    if (isReadable && placeIds.length === 0) continue;
    const standing = changeSetStanding({
      from: changeSet.from,
      to: changeSet.to,
      placeIds,
      accepted,
    });
    const priorResults = new Set(
      changeSet.priorResultSnapshots.filter(
        (snapshot) => snapshot !== changeSet.to,
      ),
    );
    const supersededAcceptance = dispositions.accepted.some(
      (entry) => entry.from === changeSet.from && priorResults.has(entry.to),
    );
    const state: ReviewInput["state"] = standing.isAccepted
      ? "answered"
      : supersededAcceptance
        ? "stale"
        : "unanswered";
    inputs.push({
      inputId: changeSet.changeSetId,
      kind: "change-set",
      label: changeSet.label,
      isCritical: false,
      state,
      detail: !isReadable
        ? "These changes are no longer available to review"
        : state === "stale"
          ? `Revised after review; ${standing.accepted} of ${standing.total} changes accepted`
          : `${standing.accepted} of ${standing.total} changes accepted`,
    });
  }
  return inputs;
};

/** Decisions lead because they are the plan's own, possibly critical inputs. */
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
