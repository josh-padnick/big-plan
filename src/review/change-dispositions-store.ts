// Owns validation, bounds, and immutable updates for the change dispositions a
// live review records.
//
// Why a disposition needs no currency predicate, and why its revision is
// ordered rather than counted, belong to ./shared/change-disposition.js; this
// module only enforces them.
//
// What this does own is refusal. The record is bounded, and a mutation past the
// bound is refused rather than trimmed to fit: dropping the oldest acceptance
// would silently reopen a change set the reviewer had already closed, and the
// open-items count would then be wrong in the direction nobody checks.

import {
  ACCEPTED_CHANGE_LIMIT,
  DISPOSITION_BATCH_LIMIT,
  PLACE_ID_LIMIT,
  SNAPSHOT_DIGEST,
  changeDispositionKey,
  type ChangeDisposition,
  type ChangeDispositionState,
} from "./shared/change-disposition.js";

/** The stored record, with the version its shape is understood under. */
export type StoredChangeDispositions = ChangeDispositionState & {
  readonly version: 1;
};

/** One browser mutation over the disposition record. */
export type ChangeDispositionMutation = {
  readonly op: "accept" | "withdraw";
  readonly from: string;
  readonly to: string;
  readonly placeIds: ReadonlyArray<string>;
  /** The server's own clock, so a browser cannot backdate an acceptance. */
  readonly acceptedAt: string;
};

export class ChangeDispositionsRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChangeDispositionsRejected";
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
    throw new ChangeDispositionsRejected(`"${field}" must be an object`);
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
    throw new ChangeDispositionsRejected(
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
    throw new ChangeDispositionsRejected('"placeId" must be non-empty text');
  }
  // Blank text names nothing, but the id itself is returned exactly as the
  // caller gave it: trimming would store an acceptance under an address the
  // browser never asked for, and the record would then answer for a different
  // place than the one the reviewer closed.
  if (value.length > PLACE_ID_LIMIT) {
    throw new ChangeDispositionsRejected(
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
    throw new ChangeDispositionsRejected(`"${field}" must be an ISO timestamp`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new ChangeDispositionsRejected(`"${field}" must be an ISO timestamp`);
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
    throw new ChangeDispositionsRejected(
      '"revision" must be a whole write count',
    );
  }
  return value;
};

const disposition = (value: unknown): ChangeDisposition => {
  const candidate = record({ value, field: "disposition" });
  return {
    from: digest({ value: candidate.from, field: "from" }),
    to: digest({ value: candidate.to, field: "to" }),
    placeId: placeId(candidate.placeId),
    acceptedAt: timestamp({
      value: candidate.acceptedAt,
      field: "acceptedAt",
    }),
  };
};

/** Validates the complete on-disk record, treating an absent file as empty. */
export const validateChangeDispositions = (
  value: unknown,
): StoredChangeDispositions => {
  if (value === undefined) return { version: 1, revision: 0, accepted: [] };
  const candidate = record({ value, field: "dispositions" });
  if (candidate.version !== 1 || !Array.isArray(candidate.accepted)) {
    throw new ChangeDispositionsRejected(
      "Change dispositions must be a version 1 record",
    );
  }
  if (candidate.accepted.length > ACCEPTED_CHANGE_LIMIT) {
    throw new ChangeDispositionsRejected(
      `Change dispositions hold more than ${ACCEPTED_CHANGE_LIMIT} accepted changes`,
    );
  }
  const accepted = candidate.accepted.map(disposition);
  if (
    new Set(accepted.map((entry) => changeDispositionKey(entry))).size !==
    accepted.length
  ) {
    throw new ChangeDispositionsRejected(
      "Change dispositions may hold only one entry per change",
    );
  }
  return {
    version: 1,
    revision: revisionNumber(candidate.revision),
    accepted,
  };
};

/**
 * Validates one browser mutation. The server stamps the acceptance time, so a
 * browser can name which changes it disposed of but never when.
 */
export const validateChangeDispositionMutation = ({
  value,
  now,
}: {
  readonly value: unknown;
  readonly now: string;
}): ChangeDispositionMutation => {
  const candidate = record({ value, field: "disposition mutation" });
  if (candidate.op !== "accept" && candidate.op !== "withdraw") {
    throw new ChangeDispositionsRejected('"op" must be "accept" or "withdraw"');
  }
  if (!Array.isArray(candidate.placeIds) || candidate.placeIds.length === 0) {
    throw new ChangeDispositionsRejected('"placeIds" must name a change');
  }
  if (candidate.placeIds.length > DISPOSITION_BATCH_LIMIT) {
    throw new ChangeDispositionsRejected(
      `"placeIds" names more than ${DISPOSITION_BATCH_LIMIT} changes`,
    );
  }
  const placeIds = candidate.placeIds.map(placeId);
  if (new Set(placeIds).size !== placeIds.length) {
    throw new ChangeDispositionsRejected('"placeIds" repeats a change');
  }
  return {
    op: candidate.op,
    from: digest({ value: candidate.from, field: "from" }),
    to: digest({ value: candidate.to, field: "to" }),
    placeIds,
    acceptedAt: now,
  };
};

/**
 * Applies one validated mutation without changing the stored array in place.
 * Every accepted mutation advances the revision, including one that withdraws
 * an acceptance and one that records nothing new, because the revision orders
 * responses rather than counting content.
 */
export const applyChangeDispositionMutation = ({
  dispositions,
  mutation,
}: {
  readonly dispositions: StoredChangeDispositions;
  readonly mutation: ChangeDispositionMutation;
}): StoredChangeDispositions => {
  const revision = dispositions.revision + 1;
  const touched = new Set(
    mutation.placeIds.map((placeId) =>
      changeDispositionKey({
        from: mutation.from,
        to: mutation.to,
        placeId,
      }),
    ),
  );
  const kept = dispositions.accepted.filter(
    (entry) => !touched.has(changeDispositionKey(entry)),
  );
  if (mutation.op === "withdraw") {
    return { version: 1, revision, accepted: kept };
  }
  const accepted = [
    ...kept,
    ...mutation.placeIds.map((placeId) => ({
      from: mutation.from,
      to: mutation.to,
      placeId,
      acceptedAt: mutation.acceptedAt,
    })),
  ];
  if (accepted.length > ACCEPTED_CHANGE_LIMIT) {
    throw new ChangeDispositionsRejected(
      `A review may record at most ${ACCEPTED_CHANGE_LIMIT} accepted changes`,
    );
  }
  return { version: 1, revision, accepted };
};
