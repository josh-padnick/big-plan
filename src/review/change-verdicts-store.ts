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
  DECIDED_CHANGE_LIMIT,
  VERDICT_BATCH_LIMIT,
  PLACE_ID_LIMIT,
  SNAPSHOT_DIGEST,
  changeVerdictKey,
  type ChangeVerdict,
  type ChangeVerdictActor,
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
  readonly from: string;
  readonly to: string;
  readonly placeIds: ReadonlyArray<string>;
  /** The server's own clock, so a browser cannot backdate a verdict. */
  readonly decidedAt: string;
  /** The trusted boundary that created this mutation, never browser input. */
  readonly actor: ChangeVerdictActor;
  /** Bulk acceptance may decide only places that are still undecided. */
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
  return {
    from: digest({ value: candidate.from, field: "from" }),
    to: digest({ value: candidate.to, field: "to" }),
    placeId: placeId(candidate.placeId),
    verdict: outcome(candidate.verdict),
    decidedAt: timestamp({
      value: candidate.decidedAt,
      field: "decidedAt",
    }),
    ...(decidedBy === undefined ? {} : { actor: decidedBy }),
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
  if (!Array.isArray(candidate.placeIds) || candidate.placeIds.length === 0) {
    throw new ChangeVerdictsRejected('"placeIds" must name a change');
  }
  if (candidate.placeIds.length > VERDICT_BATCH_LIMIT) {
    throw new ChangeVerdictsRejected(
      `"placeIds" names more than ${VERDICT_BATCH_LIMIT} changes`,
    );
  }
  const placeIds = candidate.placeIds.map(placeId);
  if (new Set(placeIds).size !== placeIds.length) {
    throw new ChangeVerdictsRejected('"placeIds" repeats a change');
  }
  if (
    candidate.onlyUndecided !== undefined &&
    (candidate.op !== "accept" || candidate.onlyUndecided !== true)
  ) {
    throw new ChangeVerdictsRejected(
      '"onlyUndecided" may only be true for an "accept" mutation',
    );
  }
  return {
    op: candidate.op,
    from: digest({ value: candidate.from, field: "from" }),
    to: digest({ value: candidate.to, field: "to" }),
    placeIds,
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
    mutation.placeIds
      .filter(
        (placeId) =>
          !mutation.onlyUndecided ||
          !verdicts.decided.some(
            (entry) =>
              entry.from === mutation.from &&
              entry.to === mutation.to &&
              entry.placeId === placeId,
          ),
      )
      .map((placeId) =>
        changeVerdictKey({
          from: mutation.from,
          to: mutation.to,
          placeId,
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
    ...mutation.placeIds
      .filter((placeId) =>
        touched.has(
          changeVerdictKey({ from: mutation.from, to: mutation.to, placeId }),
        ),
      )
      .map((placeId) => ({
        from: mutation.from,
        to: mutation.to,
        placeId,
        verdict: recorded,
        decidedAt: mutation.decidedAt,
        actor: mutation.actor,
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
