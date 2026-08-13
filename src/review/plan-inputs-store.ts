// Owns validation and immutable updates for the durable decision answers a
// live review stages before approval records them into the plan.

import type { StagedDecisionAnswer } from "./shared/review-wire.js";

const SNAPSHOT = /^[a-f0-9]{16}$/u;
const INPUT_ID = /^[\p{Letter}\p{Number}][\p{Letter}\p{Number}-]{0,299}$/u;

export type StagedInputs = {
  readonly version: 1;
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
  return value.trim();
};

const inputId = ({
  value,
  field,
}: {
  readonly value: unknown;
  readonly field: string;
}): string => {
  const id = text({ value, field });
  if (!INPUT_ID.test(id)) {
    throw new PlanInputsRejected(`"${field}" must be a decision input id`);
  }
  return id;
};

const snapshot = (value: unknown): string => {
  const digest = text({ value, field: "premiseSnapshot" });
  if (!SNAPSHOT.test(digest)) {
    throw new PlanInputsRejected(
      '"premiseSnapshot" must be a 16-character hexadecimal digest',
    );
  }
  return digest;
};

const timestamp = (value: unknown): string => {
  const at = text({ value, field: "answeredAt" });
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== at) {
    throw new PlanInputsRejected('"answeredAt" must be an ISO timestamp');
  }
  return at;
};

const answer = (value: unknown): StagedDecisionAnswer => {
  const candidate = record({ value, field: "answer" });
  return {
    decisionId: inputId({
      value: candidate.decisionId,
      field: "decisionId",
    }),
    optionId: inputId({ value: candidate.optionId, field: "optionId" }),
    optionTitle: text({
      value: candidate.optionTitle,
      field: "optionTitle",
    }),
    prompt: text({ value: candidate.prompt, field: "prompt" }),
    answeredAt: timestamp(candidate.answeredAt),
    premiseSnapshot: snapshot(candidate.premiseSnapshot),
  };
};

/** Validates the complete on-disk record, treating an absent file as empty. */
export const validateStagedInputs = (value: unknown): StagedInputs => {
  if (value === undefined) return { version: 1, answers: [] };
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
  return { version: 1, answers };
};

/** Validates one browser mutation and adds the server-owned answer time. */
export const validateStagedInputMutation = ({
  value,
  now,
}: {
  readonly value: unknown;
  readonly now: string;
}): StagedInputMutation => {
  const candidate = record({ value, field: "input mutation" });
  if (candidate.op === "retract") {
    return {
      op: "retract",
      decisionId: inputId({
        value: candidate.decisionId,
        field: "decisionId",
      }),
    };
  }
  if (candidate.op !== "stage") {
    throw new PlanInputsRejected('"op" must be "stage" or "retract"');
  }
  const draft = record({ value: candidate.answer, field: "answer" });
  return {
    op: "stage",
    answer: answer({ ...draft, answeredAt: now }),
  };
};

/** Applies one validated mutation without changing the stored array in place. */
export const applyStagedInputMutation = ({
  inputs,
  mutation,
}: {
  readonly inputs: StagedInputs;
  readonly mutation: StagedInputMutation;
}): StagedInputs => {
  const decisionId =
    mutation.op === "stage" ? mutation.answer.decisionId : mutation.decisionId;
  const existingIndex = inputs.answers.findIndex(
    (entry) => entry.decisionId === decisionId,
  );
  if (mutation.op === "retract") {
    return {
      version: 1,
      answers: inputs.answers.filter((_, index) => index !== existingIndex),
    };
  }
  if (existingIndex === -1) {
    return { version: 1, answers: [...inputs.answers, mutation.answer] };
  }
  return {
    version: 1,
    answers: inputs.answers.map((entry, index) =>
      index === existingIndex ? mutation.answer : entry,
    ),
  };
};
