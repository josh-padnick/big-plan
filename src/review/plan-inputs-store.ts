// Owns validation, currency, and immutable updates for the durable decision
// answers a live review stages before approval records them.
//
// Three facts about a stored answer each have exactly one owner here. Identity
// is the compiled inventory: an id this plan does not ask for is refused rather
// than stored, so nothing downstream has to guess whether a record is real.
// Currency is a pure read-time predicate over inert data - ids in the inventory
// and a digest still equal to the decision's content - so an edit never has to
// be raced with a deletion, and restoring the exact bytes the reviewer
// confirmed brings their answer back. Ordering is the record's revision, which
// increases on every accepted write and travels on every response.

import type { DecisionInventory } from "./decision-inventory.js";
import { BODY_LIMIT } from "./shared/comment.js";
import type { StagedDecisionAnswer } from "./shared/review-wire.js";

const DIGEST = /^[a-f0-9]{16}$/u;

export type StagedInputs = {
  readonly version: 1;
  readonly revision: number;
  readonly answers: ReadonlyArray<StagedDecisionAnswer>;
};

export type StagedInputMutation =
  | { readonly op: "stage"; readonly answer: StagedDecisionAnswer }
  | { readonly op: "retract"; readonly decisionId: string };

export class PlanInputsRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanInputsRejected";
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
    throw new PlanInputsRejected(`"${field}" must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
};

// Every stored field passes through here, so the bound lives here rather than
// at the two fields that happen to be free text today: an id is pinned by the
// inventory, but a title or a question is whatever the browser sends, and one
// write may not fill the disk or produce a record no reader can use. The bound
// is the comment store's, because a recorded answer and a comment body cost a
// reader the same.
const text = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PlanInputsRejected(`"${field}" must be non-empty text`);
  }
  const trimmed = value.trim();
  if (trimmed.length > BODY_LIMIT) {
    throw new PlanInputsRejected(
      `"${field}" is longer than ${BODY_LIMIT} characters`,
    );
  }
  return trimmed;
};

const digest = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): string => {
  const hash = text({ value, field });
  if (!DIGEST.test(hash)) {
    throw new PlanInputsRejected(
      `"${field}" must be a 16-character hexadecimal digest`,
    );
  }
  return hash;
};

const revisionNumber = (value: unknown): number => {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(value)
  ) {
    throw new PlanInputsRejected('"revision" must be a whole write count');
  }
  return value;
};

const timestamp = (value: unknown): string => {
  const at = text({ value, field: "answeredAt" });
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== at) {
    throw new PlanInputsRejected('"answeredAt" must be an ISO timestamp');
  }
  return at;
};

// Ids are the compiler's to mint and the inventory's to confirm. Re-guessing
// their shape here is what once made a long question unanswerable, so this
// checks only that a value is text and leaves membership to the inventory.
const answer = (value: unknown): StagedDecisionAnswer => {
  const candidate = record({ value, field: "answer" });
  return {
    decisionId: text({ value: candidate.decisionId, field: "decisionId" }),
    optionId: text({ value: candidate.optionId, field: "optionId" }),
    optionTitle: text({
      value: candidate.optionTitle,
      field: "optionTitle",
    }),
    prompt: text({ value: candidate.prompt, field: "prompt" }),
    answeredAt: timestamp(candidate.answeredAt),
    premiseSnapshot: digest({
      value: candidate.premiseSnapshot,
      field: "premiseSnapshot",
    }),
    decisionDigest: digest({
      value: candidate.decisionDigest,
      field: "decisionDigest",
    }),
  };
};

/** Validates the complete on-disk record, treating an absent file as empty. */
export const validateStagedInputs = (value: unknown): StagedInputs => {
  if (value === undefined) return { version: 1, revision: 0, answers: [] };
  const candidate = record({ value, field: "inputs" });
  if (candidate.version !== 1 || !Array.isArray(candidate.answers)) {
    throw new PlanInputsRejected(
      "Staged inputs must be a version 1 answer record",
    );
  }
  const answers = candidate.answers.map(answer);
  if (
    new Set(answers.map((entry) => entry.decisionId)).size !== answers.length
  ) {
    throw new PlanInputsRejected(
      "Staged inputs may contain only one answer per decision",
    );
  }
  return { version: 1, revision: revisionNumber(candidate.revision), answers };
};

/**
 * Validates one browser mutation against the decisions the plan currently asks.
 * The server owns the answer time and the decision digest, so a browser can
 * neither backdate an answer nor claim it answered content it did not see.
 */
export const validateStagedInputMutation = ({
  value,
  now,
  inventory,
}: {
  readonly value: unknown;
  readonly now: string;
  readonly inventory: DecisionInventory;
}): StagedInputMutation => {
  const candidate = record({ value, field: "input mutation" });
  if (candidate.op === "retract") {
    const decisionId = text({
      value: candidate.decisionId,
      field: "decisionId",
    });
    if (!inventory.has(decisionId)) {
      throw new PlanInputsRejected(
        '"decisionId" is not a decision in the current plan',
      );
    }
    return { op: "retract", decisionId };
  }
  if (candidate.op !== "stage") {
    throw new PlanInputsRejected('"op" must be "stage" or "retract"');
  }
  const draft = record({ value: candidate.answer, field: "answer" });
  const decisionId = text({ value: draft.decisionId, field: "decisionId" });
  const optionId = text({ value: draft.optionId, field: "optionId" });
  const entry = inventory.get(decisionId);
  if (entry === undefined) {
    throw new PlanInputsRejected(
      '"decisionId" is not a decision in the current plan',
    );
  }
  if (!entry.optionIds.has(optionId)) {
    throw new PlanInputsRejected(
      '"optionId" is not an option of that decision in the current plan',
    );
  }
  return {
    op: "stage",
    answer: answer({
      ...draft,
      answeredAt: now,
      decisionDigest: entry.decisionDigest,
    }),
  };
};

/**
 * Applies one validated mutation without changing the stored array in place.
 * Every accepted mutation advances the revision, including one that clears an
 * answer, so a reader can order two responses without inspecting their bodies.
 */
export const applyStagedInputMutation = ({
  inputs,
  mutation,
}: {
  readonly inputs: StagedInputs;
  readonly mutation: StagedInputMutation;
}): StagedInputs => {
  const revision = inputs.revision + 1;
  const decisionId =
    mutation.op === "stage" ? mutation.answer.decisionId : mutation.decisionId;
  const existingIndex = inputs.answers.findIndex(
    (entry) => entry.decisionId === decisionId,
  );
  if (mutation.op === "retract") {
    return {
      version: 1,
      revision,
      answers: inputs.answers.filter((_, index) => index !== existingIndex),
    };
  }
  if (existingIndex === -1) {
    return {
      version: 1,
      revision,
      answers: [...inputs.answers, mutation.answer],
    };
  }
  return {
    version: 1,
    revision,
    answers: inputs.answers.map((entry, index) =>
      index === existingIndex ? mutation.answer : entry,
    ),
  };
};

/**
 * True when a stored answer still answers what the plan asks. Both halves are
 * load-bearing: membership catches a decision or option the plan no longer has,
 * and digest equality catches an edit the ids survived - a rewritten option
 * summary, a new consideration, a changed recommendation. A false answer is
 * masked rather than removed, so restoring the wording revives it.
 */
export const isCurrentAnswer = ({
  answer: stored,
  inventory,
}: {
  readonly answer: StagedDecisionAnswer;
  readonly inventory: DecisionInventory;
}): boolean => {
  const entry = inventory.get(stored.decisionId);
  if (entry === undefined) return false;
  return (
    entry.optionIds.has(stored.optionId) &&
    entry.decisionDigest === stored.decisionDigest
  );
};

/** The stored answers a reader may be shown, in stored order. */
export const currentAnswers = ({
  inputs,
  inventory,
}: {
  readonly inputs: StagedInputs;
  readonly inventory: DecisionInventory;
}): ReadonlyArray<StagedDecisionAnswer> =>
  inputs.answers.filter((stored) =>
    isCurrentAnswer({ answer: stored, inventory }),
  );

/**
 * The decisions whose stored answer stopped applying while the decision itself
 * is still being asked. A reader who answered one of these is owed a reason for
 * the empty card, so this is deliberately narrower than "not current": a
 * decision the plan dropped altogether has no card left to explain anything on.
 */
export const supersededDecisionIds = ({
  inputs,
  inventory,
}: {
  readonly inputs: StagedInputs;
  readonly inventory: DecisionInventory;
}): ReadonlyArray<string> =>
  inputs.answers
    .filter(
      (stored) =>
        inventory.has(stored.decisionId) &&
        !isCurrentAnswer({ answer: stored, inventory }),
    )
    .map((stored) => stored.decisionId);
