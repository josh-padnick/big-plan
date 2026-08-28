// Owns what it means for a reviewer to have recorded a verdict for a change,
// and the one arithmetic that turns a change set plus the stored record into a
// count.
//
// A verdict is addressed by the revision it belongs to - the diff's two
// snapshot digests - plus the place inside it. That address is content-pinned
// by construction: a later plan revision produces a different result digest, so
// an acceptance can never migrate onto content the reviewer never saw. Nothing
// here needs a currency predicate for the same reason.
//
// The counting lives here rather than at each surface because a change set's
// progress is shown in more than one place at once - the digest attached to an
// agent message, the stepper reviewing that same set - and two surfaces that
// each derive it are two surfaces that can disagree about whether a reviewer
// still has work to do.

/** The revision-scoped address of one change place. */
export type ChangeVerdictAddress = {
  readonly from: string;
  readonly to: string;
  readonly placeId: string;
};

/** Who caused an accepted-change fact to be recorded. */
export type ChangeVerdictActor = "reviewer" | "auto-accept";

/**
 * One recorded verdict. Today a record holds only acceptances, so the verdict
 * is implied by membership; the address is the whole of the fact.
 */
export type ChangeVerdict = ChangeVerdictAddress & {
  readonly acceptedAt: string;
  /** Absent on older rows means reviewer. */
  readonly actor?: ChangeVerdictActor;
};

/**
 * The whole stored record, with the revision that produced it. The revision is
 * monotonic across accepted writes so a browser can order two responses without
 * inspecting their bodies, exactly as the answers store does.
 */
export type ChangeVerdictState = {
  readonly accepted: ReadonlyArray<ChangeVerdict>;
  readonly revision: number;
};

/** A snapshot digest, as every review endpoint spells one. */
export const SNAPSHOT_DIGEST = /^[a-f0-9]{16,64}$/u;

/** A place id is the diff's own, so it is bounded like any other stored id. */
export const PLACE_ID_LIMIT = 256;

/**
 * How many accepted changes one review may hold. Reached only by a review with
 * more recorded acceptances than a person could read, and refused rather than
 * trimmed: dropping the oldest entry would silently reopen a change set the
 * reviewer had already closed.
 */
export const ACCEPTED_CHANGE_LIMIT = 5_000;

/** How many places one mutation may record, so a single request stays bounded. */
export const VERDICT_BATCH_LIMIT = 500;

/**
 * The places of one gesture split into mutations the record will accept. A
 * change set can hold more places than a single request may name, and a
 * reviewer closing all of them is one gesture either way, so the split belongs
 * beside the bound that forces it rather than at the surface that trips over it.
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
  from,
  to,
  placeId,
}: ChangeVerdictAddress): string => `${from}:${to}:${placeId}`;

/** The stored acceptances as the key set every surface asks its questions of. */
export const acceptedChangeKeys = (
  state: ChangeVerdictState,
): ReadonlySet<string> =>
  new Set(state.accepted.map((entry) => changeVerdictKey(entry)));

/** How much of one change set the reviewer has closed, and how much is still open. */
export type ChangeSetStanding = {
  readonly total: number;
  readonly accepted: number;
  readonly open: number;
  readonly isAccepted: boolean;
};

/**
 * The one definition of a change set's standing. `isAccepted` is deliberately
 * false for an empty set: a change set with nothing in it has not been closed
 * by a reviewer, and calling it accepted would report work that never happened.
 */
export const changeSetStanding = ({
  from,
  to,
  placeIds,
  accepted,
}: {
  readonly from: string;
  readonly to: string;
  readonly placeIds: ReadonlyArray<string>;
  readonly accepted: ReadonlySet<string>;
}): ChangeSetStanding => {
  const total = placeIds.length;
  const closed = placeIds.filter((placeId) =>
    accepted.has(changeVerdictKey({ from, to, placeId })),
  ).length;
  return {
    total,
    accepted: closed,
    open: total - closed,
    isAccepted: total > 0 && closed === total,
  };
};
