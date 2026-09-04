// Owns validation, bounds, and immutable updates for the change verdicts a
// live review records.
//
// Why a verdict needs no currency predicate, and why its revision is
// ordered rather than counted, belong to ./shared/change-verdict.js; this
// module only enforces them.
//
// What this does own is refusal. The record is bounded, and a mutation past the
// bound is refused rather than trimmed to fit: dropping the oldest verdict
// would silently reopen a change set the reviewer had already closed, and the
// open-items count would then be wrong in the direction nobody checks.

import { join } from "node:path";
import {
  CHANGE_SET_ID,
  CONTENT_DIGEST,
  DECIDED_CHANGE_LIMIT,
  VERDICT_BATCH_LIMIT,
  PLACE_ID_LIMIT,
  SNAPSHOT_DIGEST,
  changeVerdictKey,
  type ChangeVerdict,
  type ChangeVerdictActor,
  type ChangeVerdictPlace,
  type ChangeVerdictOutcome,
  type ChangeVerdictState,
} from "./shared/change-verdict.js";
import {
  anchorReviewStore,
  readChangeVerdicts,
  ReviewStorePathRejected,
  withReviewStoreLock,
  writeChangeVerdicts,
  type ReviewStore,
} from "./store.js";

/** The stored record, with the version its shape is understood under. */
export type StoredChangeVerdicts = ChangeVerdictState & {
  readonly version: 1;
};

/**
 * One browser mutation over the verdict record.
 *
 * `undo` is one operation rather than one per verdict because it returns the
 * change to undecided whichever way it had been decided: the reviewer who
 * undoes a change does not have to know what they are undoing, and a record
 * that answered differently for the two would make an undo that arrived after
 * a re-decision silently do nothing.
 */
export type ChangeVerdictMutation = {
  readonly op: "accept" | "reject" | "undo";
  /** The change set whose decision this is, so no other set inherits it. */
  readonly changeSetId: string;
  readonly from: string;
  readonly to: string;
  /**
   * The places this decides, each with the content it is being decided over.
   * The digest comes from the diff the reviewer is looking at, for the same
   * reason the place id does: the record's job is to hold what was decided,
   * not to re-derive the change in order to name it.
   */
  readonly places: ReadonlyArray<ChangeVerdictPlace>;
  /** The server's own clock, so a browser cannot backdate a verdict. */
  readonly decidedAt: string;
  /** The trusted boundary that created this mutation, never browser input. */
  readonly actor: ChangeVerdictActor;
  /** A bulk verdict may decide only places that are still undecided. */
  readonly onlyUndecided?: boolean;
};

/** The verdict an operation records, or `undefined` when it records none. */
export const verdictOfMutationOp = (
  op: ChangeVerdictMutation["op"],
): ChangeVerdictOutcome | undefined => {
  if (op === "accept") return "accepted";
  return op === "reject" ? "rejected" : undefined;
};

export class ChangeVerdictsRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeVerdictsRejected";
  }
}

const record = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ChangeVerdictsRejected(`"${field}" must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
};

// A change-set id addresses the owner of a decision, so it is checked to the
// same shape the committed revision log mints one in. An id no change set
// holds addresses no decision and is inert rather than dangerous, but a
// free-form one would let a browser widen a verdict past any owner at all.
const changeSetId = (value: unknown): string => {
  if (typeof value !== "string" || !CHANGE_SET_ID.test(value)) {
    throw new ChangeVerdictsRejected(
      '"changeSetId" must be a hexadecimal change-set id',
    );
  }
  return value;
};

const digest = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): string => {
  if (typeof value !== "string" || !SNAPSHOT_DIGEST.test(value)) {
    throw new ChangeVerdictsRejected(
      `"${field}" must be a hexadecimal snapshot digest`,
    );
  }
  return value;
};

// A place id is minted by the diff the browser is reviewing, so this checks
// that it is bounded text and leaves its meaning to the diff. An id no diff
// produces addresses no change and is inert rather than dangerous.
const placeId = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ChangeVerdictsRejected('"placeId" must be non-empty text');
  }
  // Blank text names nothing, but the id itself is returned exactly as the
  // caller gave it: trimming would store a verdict under an address the
  // browser never asked for, and the record would then answer for a different
  // place than the one the reviewer closed.
  if (value.length > PLACE_ID_LIMIT) {
    throw new ChangeVerdictsRejected(
      `"placeId" is longer than ${PLACE_ID_LIMIT} characters`,
    );
  }
  return value;
};

// A content digest says what the reviewer decided over. It is optional at the
// boundary because a surface that cannot say is honest to leave it out; what
// it may not be is malformed, since a digest nothing minted would report a
// live verdict as stale forever.
const contentDigest = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !CONTENT_DIGEST.test(value)) {
    throw new ChangeVerdictsRejected(
      '"contentDigest" must be a hexadecimal digest',
    );
  }
  return value;
};

const timestamp = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): string => {
  if (typeof value !== "string") {
    throw new ChangeVerdictsRejected(`"${field}" must be an ISO timestamp`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new ChangeVerdictsRejected(`"${field}" must be an ISO timestamp`);
  }
  return value;
};

const revisionNumber = (value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(value)
  ) {
    throw new ChangeVerdictsRejected('"revision" must be a whole write count');
  }
  return value;
};

const actor = (value: unknown): ChangeVerdictActor | undefined => {
  if (value === undefined) return undefined;
  if (value !== "reviewer" && value !== "auto-accept") {
    throw new ChangeVerdictsRejected(
      '"actor" must be "reviewer" or "auto-accept"',
    );
  }
  return value;
};

const outcome = (value: unknown): ChangeVerdictOutcome => {
  if (value !== "accepted" && value !== "rejected") {
    throw new ChangeVerdictsRejected(
      '"verdict" must be "accepted" or "rejected"',
    );
  }
  return value;
};

const verdict = (value: unknown): ChangeVerdict => {
  const candidate = record({ value, field: "verdict" });
  const decidedBy = actor(candidate.actor);
  const decidedOver = contentDigest(candidate.contentDigest);
  return {
    changeSetId: changeSetId(candidate.changeSetId),
    from: digest({ value: candidate.from, field: "from" }),
    to: digest({ value: candidate.to, field: "to" }),
    placeId: placeId(candidate.placeId),
    verdict: outcome(candidate.verdict),
    decidedAt: timestamp({
      value: candidate.decidedAt,
      field: "decidedAt",
    }),
    ...(decidedBy === undefined ? {} : { actor: decidedBy }),
    ...(decidedOver === undefined ? {} : { contentDigest: decidedOver }),
  };
};

/** Validates the complete on-disk record, treating an absent file as empty. */
export const validateChangeVerdicts = (
  value: unknown,
): StoredChangeVerdicts => {
  if (value === undefined) return { version: 1, revision: 0, decided: [] };
  const candidate = record({ value, field: "verdicts" });
  if (candidate.version !== 1 || !Array.isArray(candidate.decided)) {
    throw new ChangeVerdictsRejected(
      "Change verdicts must be a version 1 record",
    );
  }
  if (candidate.decided.length > DECIDED_CHANGE_LIMIT) {
    throw new ChangeVerdictsRejected(
      `Change verdicts hold more than ${DECIDED_CHANGE_LIMIT} decided changes`,
    );
  }
  const decided = candidate.decided.map(verdict);
  if (
    new Set(decided.map((entry) => changeVerdictKey(entry))).size !==
    decided.length
  ) {
    throw new ChangeVerdictsRejected(
      "Change verdicts may hold only one entry per change",
    );
  }
  return {
    version: 1,
    revision: revisionNumber(candidate.revision),
    decided,
  };
};

/**
 * Validates one browser mutation. The server stamps the decision time, so a
 * browser can name which changes receive a verdict but never when.
 */
export const validateChangeVerdictMutation = ({
  value,
  now,
}: {
  readonly value: unknown;
  readonly now: string;
}): ChangeVerdictMutation => {
  const candidate = record({ value, field: "verdict mutation" });
  if (
    candidate.op !== "accept" &&
    candidate.op !== "reject" &&
    candidate.op !== "undo"
  ) {
    throw new ChangeVerdictsRejected(
      '"op" must be "accept", "reject" or "undo"',
    );
  }
  if (!Array.isArray(candidate.places) || candidate.places.length === 0) {
    throw new ChangeVerdictsRejected('"places" must name a change');
  }
  if (candidate.places.length > VERDICT_BATCH_LIMIT) {
    throw new ChangeVerdictsRejected(
      `"places" names more than ${VERDICT_BATCH_LIMIT} changes`,
    );
  }
  const places = candidate.places.map((value): ChangeVerdictPlace => {
    const entry = record({ value, field: "place" });
    const decidedOver = contentDigest(entry.contentDigest);
    return {
      placeId: placeId(entry.placeId),
      ...(decidedOver === undefined ? {} : { contentDigest: decidedOver }),
    };
  });
  if (new Set(places.map((place) => place.placeId)).size !== places.length) {
    throw new ChangeVerdictsRejected('"places" repeats a change');
  }
  if (
    candidate.onlyUndecided !== undefined &&
    (candidate.op === "undo" || candidate.onlyUndecided !== true)
  ) {
    throw new ChangeVerdictsRejected(
      '"onlyUndecided" may only be true for an "accept" or "reject" mutation',
    );
  }
  return {
    op: candidate.op,
    changeSetId: changeSetId(candidate.changeSetId),
    from: digest({ value: candidate.from, field: "from" }),
    to: digest({ value: candidate.to, field: "to" }),
    places,
    decidedAt: now,
    actor: "reviewer",
    ...(candidate.onlyUndecided === undefined
      ? {}
      : { onlyUndecided: candidate.onlyUndecided }),
  };
};

/**
 * Applies one validated mutation without changing the stored array in place.
 * Every accepted mutation advances the revision, including one that undoes a
 * verdict and one that records nothing new, because the revision orders
 * responses rather than counting content.
 */
export const applyChangeVerdictMutation = ({
  verdicts,
  mutation,
}: {
  readonly verdicts: StoredChangeVerdicts;
  readonly mutation: ChangeVerdictMutation;
}): StoredChangeVerdicts => {
  const revision = verdicts.revision + 1;
  const touched = new Set(
    mutation.places
      .filter((place) => {
        if (!mutation.onlyUndecided) return true;
        const existing = verdicts.decided.find(
          (entry) =>
            entry.changeSetId === mutation.changeSetId &&
            entry.from === mutation.from &&
            entry.to === mutation.to &&
            entry.placeId === place.placeId,
        );
        if (existing === undefined) return true;
        return (
          place.contentDigest !== undefined &&
          existing.contentDigest !== undefined &&
          place.contentDigest !== existing.contentDigest
        );
      })
      .map((place) =>
        changeVerdictKey({
          changeSetId: mutation.changeSetId,
          from: mutation.from,
          to: mutation.to,
          placeId: place.placeId,
        }),
      ),
  );
  // Every operation clears the addresses it names first, so re-deciding a
  // change replaces its row rather than adding a second one, and undo is that
  // clearing on its own: the address is left undecided and open to either
  // verdict again, exactly as it was before the first decision.
  const kept = verdicts.decided.filter(
    (entry) => !touched.has(changeVerdictKey(entry)),
  );
  const recorded = verdictOfMutationOp(mutation.op);
  if (recorded === undefined) {
    return { version: 1, revision, decided: kept };
  }
  const decided = [
    ...kept,
    ...mutation.places
      .filter((place) =>
        touched.has(
          changeVerdictKey({
            changeSetId: mutation.changeSetId,
            from: mutation.from,
            to: mutation.to,
            placeId: place.placeId,
          }),
        ),
      )
      .map((place) => ({
        changeSetId: mutation.changeSetId,
        from: mutation.from,
        to: mutation.to,
        placeId: place.placeId,
        verdict: recorded,
        decidedAt: mutation.decidedAt,
        actor: mutation.actor,
        ...(place.contentDigest === undefined
          ? {}
          : { contentDigest: place.contentDigest }),
      })),
  ];
  if (decided.length > DECIDED_CHANGE_LIMIT) {
    throw new ChangeVerdictsRejected(
      `A review may record at most ${DECIDED_CHANGE_LIMIT} decided changes`,
    );
  }
  return { version: 1, revision, decided };
};

/**
 * The places of one revision the record has rejected, in stored order.
 *
 * A rejected place is the one verdict that also owns bytes, so the set of them
 * is what the plan source has to agree with. Deriving it here keeps that
 * question answerable from the record alone.
 *
 * It reads across owners deliberately, where the address a verdict is stored
 * under does not. A verdict is one change set's decision, but the plan source
 * is shared, so the bytes have to follow every rejection recorded against the
 * revision rather than whichever set the reviewer happened to be reading.
 */
export const rejectedPlaceIdsFor = ({
  verdicts,
  from,
  to,
}: {
  readonly verdicts: ChangeVerdictState;
  readonly from: string;
  readonly to: string;
}): ReadonlyArray<string> =>
  verdicts.decided
    .filter(
      (entry) =>
        entry.verdict === "rejected" && entry.from === from && entry.to === to,
    )
    .map((entry) => entry.placeId);

/** Merges an approval's decided places into the latest locked record. */
export const mergeFinalizedChangeVerdicts = ({
  current,
  finalized,
}: {
  readonly current: StoredChangeVerdicts;
  readonly finalized: StoredChangeVerdicts;
}): StoredChangeVerdicts => {
  const currentByKey = new Map(
    current.decided.map((entry) => [changeVerdictKey(entry), entry]),
  );
  const isAlreadyFinalized = finalized.decided.every((entry) => {
    const stored = currentByKey.get(changeVerdictKey(entry));
    return (
      stored?.decidedAt === entry.decidedAt &&
      stored.verdict === entry.verdict &&
      stored.actor === entry.actor
    );
  });
  if (isAlreadyFinalized) return current;
  const finalizedKeys = new Set(finalized.decided.map(changeVerdictKey));
  const decided = [
    ...current.decided.filter(
      (entry) => !finalizedKeys.has(changeVerdictKey(entry)),
    ),
    ...finalized.decided,
  ];
  if (decided.length > DECIDED_CHANGE_LIMIT) {
    throw new ChangeVerdictsRejected(
      `A review may record at most ${DECIDED_CHANGE_LIMIT} decided changes`,
    );
  }
  return {
    version: 1,
    revision: Math.max(current.revision, finalized.revision) + 1,
    decided,
  };
};

/**
 * Updates the verdict record under its cross-process lock.
 *
 * Auto-accept commits run in the agent process while reviewer mutations run in
 * the review runtime, so a runtime-local write gate cannot serialize them.
 * The read and replacement stay together here so neither writer can erase the
 * other's decided places.
 */
export const updateStoredChangeVerdicts = async ({
  store,
  change,
}: {
  readonly store: ReviewStore;
  readonly change: (verdicts: StoredChangeVerdicts) => StoredChangeVerdicts;
}): Promise<StoredChangeVerdicts> => {
  let lockedStore: ReviewStore;
  try {
    lockedStore = await (await anchorReviewStore(store)).resolveStore();
  } catch (error: unknown) {
    if (!(error instanceof ReviewStorePathRejected)) throw error;
    throw new ChangeVerdictsRejected(
      "The change verdict record is unavailable",
    );
  }
  return withReviewStoreLock({
    lockPath: join(lockedStore.reviewDirectory, ".change-verdicts.lock"),
    change: async () => {
      const current = await readChangeVerdicts({
        store: lockedStore,
        validate: validateChangeVerdicts,
      });
      const next = change(current);
      if (next === current) return current;
      await writeChangeVerdicts({ store: lockedStore, verdicts: next });
      return next;
    },
    timeoutError: () =>
      new ChangeVerdictsRejected(
        "Another process is changing the verdict record. Try again.",
      ),
    invalidLockError: () =>
      new ChangeVerdictsRejected("The change verdict record is unavailable"),
  });
};
