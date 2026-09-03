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
//
// A change set's span advances as its thread commits more rounds, which renames
// every place in it, so a verdict is carried onto the new address by the block
// it is about rather than left at an address nothing asks about any more. What
// a carried verdict cannot promise is that it still applies: the round that
// advanced the set may have rewritten the very change it was given for. So a
// row also carries a digest of the content it was decided over, and a row whose
// digest no longer matches the place in front of the reviewer reads as `stale` -
// "you decided this, and it changed again" - rather than as either a live
// verdict or a change nobody has seen. That is the same shape, and the same
// word, the decision-answers record already uses for an answer the plan moved
// out from under; and it is self-healing in the same way, because restoring the
// content restores the digest and with it the verdict.

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
 * ever stores it, and `stale` is the answer for a row whose content moved,
 * which is why nothing stores that either: both are read off the record rather
 * than written into it.
 */
export type ChangeDisposition = ChangeVerdictOutcome | "undecided" | "stale";

/** One recorded verdict: the address, the answer, and when it was given. */
export type ChangeVerdict = ChangeVerdictAddress & {
  readonly verdict: ChangeVerdictOutcome;
  readonly decidedAt: string;
  /** Absent means reviewer. */
  readonly actor?: ChangeVerdictActor;
  /**
   * A digest of the change's content at the moment it was decided. Absent on a
   * row written before the reviewer's surface could supply one, and absence is
   * read as "cannot tell", which keeps the verdict live rather than inventing
   * staleness the record has no evidence for.
   */
  readonly contentDigest?: string;
};

/**
 * One place a verdict operation names, with the content the reviewer decided
 * over. The digest travels with the place rather than beside it because the
 * two are one fact: a verdict given for content nobody recorded cannot later
 * say whether that content moved.
 */
export type ChangeVerdictPlace = {
  readonly placeId: string;
  readonly contentDigest?: string;
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

/** A content digest, as the diff mints one for the place it describes. */
export const CONTENT_DIGEST = /^[a-f0-9]{16,64}$/u;

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
export const changeVerdictBatches = <T>(
  places: ReadonlyArray<T>,
): ReadonlyArray<ReadonlyArray<T>> => {
  const batches: Array<ReadonlyArray<T>> = [];
  for (let start = 0; start < places.length; start += VERDICT_BATCH_LIMIT) {
    batches.push(places.slice(start, start + VERDICT_BATCH_LIMIT));
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
 * The content each decided address was decided over, for the surfaces that can
 * compare it with what is now in front of the reviewer.
 *
 * A row with no digest is absent from this map rather than present with a
 * placeholder: the two mean different things, and a placeholder would report a
 * verdict as stale on the strength of a fact nobody recorded.
 */
export const decidedContentDigests = (
  state: ChangeVerdictState,
): ReadonlyMap<string, string> =>
  new Map(
    state.decided.flatMap((entry) =>
      entry.contentDigest === undefined
        ? []
        : [[changeVerdictKey(entry), entry.contentDigest] as const],
    ),
  );

/**
 * What the record says about one address. Every caller that needs the whole
 * answer rather than one side of it reads this, so nothing has to spell out
 * that a change in neither set is undecided.
 *
 * A decided address whose content has moved since answers `stale`. Both halves
 * of that comparison have to be present for it to fire: a caller that cannot
 * say what the place holds now, and a row that never said what it was decided
 * over, both leave the verdict live rather than reporting a staleness neither
 * of them has evidence for.
 */
export const changeDispositionOf = ({
  address,
  accepted,
  rejected,
  decidedDigests,
  contentDigest,
}: {
  readonly address: ChangeVerdictAddress;
  readonly accepted: ReadonlySet<string>;
  readonly rejected: ReadonlySet<string>;
  /** What each decided address was decided over, where the record says. */
  readonly decidedDigests?: ReadonlyMap<string, string>;
  /** What this place holds now, where the caller can say. */
  readonly contentDigest?: string;
}): ChangeDisposition => {
  const key = changeVerdictKey(address);
  const decided = accepted.has(key)
    ? "accepted"
    : rejected.has(key)
      ? "rejected"
      : "undecided";
  if (decided === "undecided") return decided;
  const decidedOver = decidedDigests?.get(key);
  if (decidedOver === undefined || contentDigest === undefined) return decided;
  return decidedOver === contentDigest ? decided : "stale";
};

/** How much of one change set is decided, how it was decided, and what is left. */
export type ChangeSetStanding = {
  readonly total: number;
  readonly accepted: number;
  readonly rejected: number;
  readonly open: number;
  /**
   * How many of the open places the reviewer had already decided before the
   * content moved. It is a subset of `open` rather than a fourth column beside
   * it, exactly as the decision contract counts a stale answer: the work is
   * owed again either way, and the count exists so the reviewer can be told
   * which of it they have seen before.
   */
  readonly stale: number;
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
 * `open` counts every place without a verdict that still applies, so a rejected
 * change stops asking the reviewer for an answer exactly as an accepted one
 * does, while a decision the content moved out from under starts asking again.
 * The three stay separate above that because they leave the reviewer owing
 * different things.
 */
export const changeSetStanding = ({
  changeSetId,
  from,
  to,
  places,
  accepted,
  rejected,
  decidedDigests,
}: ChangeVerdictScope & {
  readonly places: ReadonlyArray<ChangeVerdictPlace>;
  readonly accepted: ReadonlySet<string>;
  readonly rejected: ReadonlySet<string>;
  readonly decidedDigests?: ReadonlyMap<string, string>;
}): ChangeSetStanding => {
  const total = places.length;
  const dispositions = places.map((place) =>
    changeDispositionOf({
      address: { changeSetId, from, to, placeId: place.placeId },
      accepted,
      rejected,
      ...(decidedDigests === undefined ? {} : { decidedDigests }),
      ...(place.contentDigest === undefined
        ? {}
        : { contentDigest: place.contentDigest }),
    }),
  );
  const countOf = (answer: ChangeDisposition): number =>
    dispositions.filter((disposition) => disposition === answer).length;
  const acceptedCount = countOf("accepted");
  const rejectedCount = countOf("rejected");
  const decided = acceptedCount + rejectedCount;
  return {
    total,
    accepted: acceptedCount,
    rejected: rejectedCount,
    open: total - decided,
    stale: countOf("stale"),
    isAccepted: total > 0 && acceptedCount === total,
    isSettled: total > 0 && decided === total,
  };
};
