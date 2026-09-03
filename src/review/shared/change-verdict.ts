// Owns what it means to record a verdict for a change, including who caused
// the fact to be recorded, and the one arithmetic that turns a change set plus
// the stored record into a count.
//
// A change has exactly three dispositions - accepted, rejected, undecided - and
// undecided is the state every change starts in and returns to. The record
// holds a row only for the two verdicts, so undecided needs no stored value:
// it is what the record says about an address it holds nothing for.
//
// Undo puts a change back into undecided, which is a live state and not an
// ending. The reviewer who undoes a verdict is asking to decide again, and the
// change is once more waiting for an answer that may be either accept or
// reject - so nothing about how the first decision went can survive to
// constrain the second.
//
// A verdict is addressed by the change set that proposed it, the revision it
// belongs to - the diff's two snapshot digests - and the place inside it. That
// address is content-pinned by construction: a later plan revision produces a
// different result digest, so a verdict can never migrate onto different
// content. Nothing here needs a currency predicate for the same reason.
//
// The change set is part of the address because a revision line is shared and
// a reviewer's decision is not. Two threads answered by one revision routinely
// attribute the same place - their edits land side by side and the diff groups
// them - and without an owner in the key those two threads hold one acceptance
// fact between them, so closing one silently closes the other. The owner makes
// the address say whose decision it is, which is the difference between a
// record that can be read back per thread and one that cannot.
//
// The counting lives here rather than at each surface because a change set's
// progress is shown in more than one place at once - the digest attached to an
// agent message, the stepper reviewing that same set - and two surfaces that
// each derive it are two surfaces that can disagree about whether the change
// set still has open work.

/**
 * The scope one surface records verdicts under: the change set that owns the
 * decision, and the revision its diff spans.
 *
 * It is named separately from the address because every surface that decides
 * changes holds it once and names many places inside it, and because a scope
 * with no place in it is still the thing a standing is counted over.
 */
export type ChangeVerdictScope = {
  readonly changeSetId: string;
  readonly from: string;
  readonly to: string;
};

/** The owner- and revision-scoped address of one change place. */
export type ChangeVerdictAddress = ChangeVerdictScope & {
  readonly placeId: string;
};

/** Who caused a decided-change fact to be recorded. */
export type ChangeVerdictActor = "reviewer" | "auto-accept";

/** The two verdicts a reviewer can record over one change. */
export type ChangeVerdictOutcome = "accepted" | "rejected";

/**
 * What a review has decided about one change place, as every surface that
 * presents a change asks it.
 *
 * It is a named union rather than a boolean because the disposition is what
 * presentation switches on, and the reject verdict is a third answer to this
 * one selector rather than a second question beside it - which is what keeps
 * the stored record a single shape instead of a fork. `undecided` is the
 * answer for every address the record holds no row for, which is why nothing
 * ever stores it.
 */
export type ChangeDisposition = ChangeVerdictOutcome | "undecided";

/** One recorded verdict: the address, the answer, and when it was given. */
export type ChangeVerdict = ChangeVerdictAddress & {
  readonly verdict: ChangeVerdictOutcome;
  readonly decidedAt: string;
  /** Absent means reviewer. */
  readonly actor?: ChangeVerdictActor;
};

/**
 * The whole stored record, with the revision that produced it. The revision is
 * monotonic across accepted writes so a browser can order two responses without
 * inspecting their bodies, exactly as the answers store does.
 */
export type ChangeVerdictState = {
  readonly decided: ReadonlyArray<ChangeVerdict>;
  readonly revision: number;
};

/** A snapshot digest, as every review endpoint spells one. */
export const SNAPSHOT_DIGEST = /^[a-f0-9]{16,64}$/u;

/**
 * A change-set id, as both the committed revision log and the verdict record
 * spell one. It names either an ordinary comment thread or an immutable
 * request-keyed transaction, so it accepts short comment ids and request ids.
 */
export const CHANGE_SET_ID = /^[a-f0-9]{4,64}$/u;

/** A place id is the diff's own, so it is bounded like any other stored id. */
export const PLACE_ID_LIMIT = 256;

/**
 * How many decided changes one review may hold. Reached only by a review with
 * more recorded verdicts than a review could reasonably present, and refused
 * rather than trimmed: dropping the oldest row would silently reopen a change
 * set that was already closed.
 */
export const DECIDED_CHANGE_LIMIT = 5_000;

/** How many places one mutation may record, so a single request stays bounded. */
export const VERDICT_BATCH_LIMIT = 500;

/**
 * The places of one verdict operation split into mutations the record will
 * accept. A change set can hold more places than a single request may name, and
 * deciding all of them is one operation either way, so the split belongs beside
 * the bound that forces it rather than at the surface that trips over it.
 */
export const changeVerdictBatches = (
  placeIds: ReadonlyArray<string>,
): ReadonlyArray<ReadonlyArray<string>> => {
  const batches: Array<ReadonlyArray<string>> = [];
  for (let start = 0; start < placeIds.length; start += VERDICT_BATCH_LIMIT) {
    batches.push(placeIds.slice(start, start + VERDICT_BATCH_LIMIT));
  }
  return batches;
};

/** The key one verdict is stored and looked up under. */
export const changeVerdictKey = ({
  changeSetId,
  from,
  to,
  placeId,
}: ChangeVerdictAddress): string => `${changeSetId}:${from}:${to}:${placeId}`;

const keysWithVerdict = ({
  state,
  verdict,
}: {
  readonly state: ChangeVerdictState;
  readonly verdict: ChangeVerdictOutcome;
}): ReadonlySet<string> =>
  new Set(
    state.decided
      .filter((entry) => entry.verdict === verdict)
      .map((entry) => changeVerdictKey(entry)),
  );

/** The stored acceptances as the key set every surface asks its questions of. */
export const acceptedChangeKeys = (
  state: ChangeVerdictState,
): ReadonlySet<string> => keysWithVerdict({ state, verdict: "accepted" });

/** The stored rejections, read the same way acceptances are. */
export const rejectedChangeKeys = (
  state: ChangeVerdictState,
): ReadonlySet<string> => keysWithVerdict({ state, verdict: "rejected" });

/**
 * What the record says about one address. Every caller that needs the whole
 * answer rather than one side of it reads this, so nothing has to spell out
 * that a change in neither set is undecided.
 */
export const changeDispositionOf = ({
  address,
  accepted,
  rejected,
}: {
  readonly address: ChangeVerdictAddress;
  readonly accepted: ReadonlySet<string>;
  readonly rejected: ReadonlySet<string>;
}): ChangeDisposition => {
  const key = changeVerdictKey(address);
  if (accepted.has(key)) return "accepted";
  return rejected.has(key) ? "rejected" : "undecided";
};

/** How much of one change set is decided, how it was decided, and what is left. */
export type ChangeSetStanding = {
  readonly total: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly open: number;
  readonly isAccepted: boolean;
  /** Every place has a verdict, whichever way each one went. */
  readonly isSettled: boolean;
};

/**
 * The one definition of a change set's standing. `isAccepted` and `isSettled`
 * are deliberately false for an empty set: a change set with nothing in it has
 * not been closed by a verdict, and calling it settled would report work that
 * never happened.
 *
 * `open` counts only the places nobody has decided, so a rejected change stops
 * asking the reviewer for an answer exactly as an accepted one does. The two
 * stay separate above that because they leave the plan in opposite states.
 */
export const changeSetStanding = ({
  changeSetId,
  from,
  to,
  placeIds,
  accepted,
  rejected,
}: ChangeVerdictScope & {
  readonly placeIds: ReadonlyArray<string>;
  readonly accepted: ReadonlySet<string>;
  readonly rejected: ReadonlySet<string>;
}): ChangeSetStanding => {
  const total = placeIds.length;
  const dispositions = placeIds.map((placeId) =>
    changeDispositionOf({
      address: { changeSetId, from, to, placeId },
      accepted,
      rejected,
    }),
  );
  const acceptedCount = dispositions.filter(
    (disposition) => disposition === "accepted",
  ).length;
  const rejectedCount = dispositions.filter(
    (disposition) => disposition === "rejected",
  ).length;
  const decided = acceptedCount + rejectedCount;
  return {
    total,
    accepted: acceptedCount,
    rejected: rejectedCount,
    open: total - decided,
    isAccepted: total > 0 && acceptedCount === total,
    isSettled: total > 0 && decided === total,
  };
};
