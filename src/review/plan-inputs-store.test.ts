// Proves the durable decision-answer record accepts only what the compiled plan
// asks for, orders its writes, and reports currency from stored content alone.

import { describe, expect, it } from "vitest";
import type { DecisionInventory } from "./decision-inventory.js";
import {
  applyStagedInputMutation,
  currentAnswers,
  isCurrentAnswer,
  supersededDecisionIds,
  validateStagedInputMutation,
  validateStagedInputs,
} from "./plan-inputs-store.js";

const DECISION_ID = "decision-release-path";
const GRADUAL_ID = "decision-release-path-option-gradual";
const IMMEDIATE_ID = "decision-release-path-option-immediate";
const DECISION_DIGEST = "abcdef0123456789";

const FIRST_ANSWER = {
  decisionId: DECISION_ID,
  optionId: GRADUAL_ID,
  optionTitle: "Gradual",
  prompt: "Which release path?",
  premiseSnapshot: "0123456789abcdef",
} as const;

const STORED_ANSWER = {
  ...FIRST_ANSWER,
  answeredAt: "2026-08-13T17:04:00.000Z",
  decisionDigest: DECISION_DIGEST,
} as const;

const inventoryOf = ({
  decisionId = DECISION_ID,
  optionIds = [GRADUAL_ID, IMMEDIATE_ID],
  decisionDigest = DECISION_DIGEST,
}: {
  readonly decisionId?: string;
  readonly optionIds?: ReadonlyArray<string>;
  readonly decisionDigest?: string;
} = {}): DecisionInventory =>
  new Map([
    [decisionId, { decisionId, optionIds: new Set(optionIds), decisionDigest }],
  ]);

const INVENTORY = inventoryOf();

describe("staged decision inputs", () => {
  it("should round-trip a valid versioned answer record", () => {
    const stored = { version: 1, revision: 3, answers: [STORED_ANSWER] };

    expect(validateStagedInputs(JSON.parse(JSON.stringify(stored)))).toEqual(
      stored,
    );
  });

  it("should read an absent record as an empty one at revision zero", () => {
    expect(validateStagedInputs(undefined)).toEqual({
      version: 1,
      revision: 0,
      answers: [],
    });
  });

  it("should reject a record with no write count", () => {
    expect(() =>
      validateStagedInputs({ version: 1, answers: [STORED_ANSWER] }),
    ).toThrow("whole write count");
  });

  it("should reject duplicate answers for one decision", () => {
    expect(() =>
      validateStagedInputs({
        version: 1,
        revision: 2,
        answers: [
          STORED_ANSWER,
          { ...STORED_ANSWER, answeredAt: "2026-08-13T17:05:00.000Z" },
        ],
      }),
    ).toThrow("one answer per decision");
  });

  it("should accept Unicode letters preserved by component id slugs", () => {
    const staged = validateStagedInputMutation({
      value: {
        op: "stage",
        answer: {
          ...FIRST_ANSWER,
          decisionId: "decision-qué-vía",
          optionId: "decision-qué-vía-option-café",
        },
      },
      now: "2026-08-13T17:04:00.000Z",
      inventory: inventoryOf({
        decisionId: "decision-qué-vía",
        optionIds: ["decision-qué-vía-option-café"],
      }),
    });

    expect(staged).toMatchObject({
      answer: {
        decisionId: "decision-qué-vía",
        optionId: "decision-qué-vía-option-café",
      },
    });
  });

  it("should accept a compiled id of any length the plan produces", () => {
    const decisionId = `decision-${"release-".repeat(60)}path`;
    const optionId = `${decisionId}-option-gradual`;
    expect(decisionId.length).toBeGreaterThan(300);

    expect(
      validateStagedInputMutation({
        value: {
          op: "stage",
          answer: { ...FIRST_ANSWER, decisionId, optionId },
        },
        now: "2026-08-13T17:04:00.000Z",
        inventory: inventoryOf({ decisionId, optionIds: [optionId] }),
      }),
    ).toMatchObject({ answer: { decisionId, optionId } });
  });

  it("should stamp the answered decision's digest from the inventory", () => {
    expect(
      validateStagedInputMutation({
        value: {
          op: "stage",
          answer: { ...FIRST_ANSWER, decisionDigest: "ffffffffffffffff" },
        },
        now: "2026-08-13T17:04:00.000Z",
        inventory: INVENTORY,
      }),
    ).toMatchObject({ answer: { decisionDigest: DECISION_DIGEST } });
  });

  it("should refuse a decision the compiled plan does not ask", () => {
    expect(() =>
      validateStagedInputMutation({
        value: {
          op: "stage",
          answer: { ...FIRST_ANSWER, decisionId: "decision-reworded" },
        },
        now: "2026-08-13T17:04:00.000Z",
        inventory: INVENTORY,
      }),
    ).toThrow("not a decision in the current plan");

    expect(() =>
      validateStagedInputMutation({
        value: { op: "retract", decisionId: "decision-reworded" },
        now: "2026-08-13T17:04:00.000Z",
        inventory: INVENTORY,
      }),
    ).toThrow("not a decision in the current plan");
  });

  it("should refuse an option the answered decision does not offer", () => {
    expect(() =>
      validateStagedInputMutation({
        value: {
          op: "stage",
          answer: { ...FIRST_ANSWER, optionId: `${DECISION_ID}-option-none` },
        },
        now: "2026-08-13T17:04:00.000Z",
        inventory: INVENTORY,
      }),
    ).toThrow("not an option of that decision");
  });

  it("should replace and retract the current answer for one decision", () => {
    const first = validateStagedInputMutation({
      value: { op: "stage", answer: FIRST_ANSWER },
      now: "2026-08-13T17:04:00.000Z",
      inventory: INVENTORY,
    });
    const second = validateStagedInputMutation({
      value: {
        op: "stage",
        answer: {
          ...FIRST_ANSWER,
          optionId: IMMEDIATE_ID,
          optionTitle: "Immediate",
        },
      },
      now: "2026-08-13T17:05:00.000Z",
      inventory: INVENTORY,
    });
    const retract = validateStagedInputMutation({
      value: { op: "retract", decisionId: DECISION_ID },
      now: "2026-08-13T17:06:00.000Z",
      inventory: INVENTORY,
    });

    const staged = applyStagedInputMutation({
      inputs: applyStagedInputMutation({
        inputs: { version: 1, revision: 0, answers: [] },
        mutation: first,
      }),
      mutation: second,
    });
    expect(staged.answers).toHaveLength(1);
    expect(staged.answers[0]?.optionTitle).toBe("Immediate");
    expect(
      applyStagedInputMutation({ inputs: staged, mutation: retract }).answers,
    ).toEqual([]);
  });

  it("should advance the revision on every accepted write", () => {
    const stage = validateStagedInputMutation({
      value: { op: "stage", answer: FIRST_ANSWER },
      now: "2026-08-13T17:04:00.000Z",
      inventory: INVENTORY,
    });
    const retract = validateStagedInputMutation({
      value: { op: "retract", decisionId: DECISION_ID },
      now: "2026-08-13T17:05:00.000Z",
      inventory: INVENTORY,
    });

    const staged = applyStagedInputMutation({
      inputs: { version: 1, revision: 7, answers: [] },
      mutation: stage,
    });
    expect(staged.revision).toBe(8);
    expect(
      applyStagedInputMutation({ inputs: staged, mutation: retract }).revision,
    ).toBe(9);
  });
});

describe("decision answer currency", () => {
  it("should hold an answer current while its ids and digest all match", () => {
    expect(
      isCurrentAnswer({ answer: STORED_ANSWER, inventory: INVENTORY }),
    ).toBe(true);
  });

  it("should drop an answer whose decision the plan no longer asks", () => {
    expect(
      isCurrentAnswer({
        answer: STORED_ANSWER,
        inventory: inventoryOf({ decisionId: "decision-reworded" }),
      }),
    ).toBe(false);
  });

  it("should drop an answer whose option the decision no longer offers", () => {
    expect(
      isCurrentAnswer({
        answer: STORED_ANSWER,
        inventory: inventoryOf({ optionIds: [IMMEDIATE_ID] }),
      }),
    ).toBe(false);
  });

  it("should drop an answer whose decision content changed under its ids", () => {
    expect(
      isCurrentAnswer({
        answer: STORED_ANSWER,
        inventory: inventoryOf({ decisionDigest: "0000000000000000" }),
      }),
    ).toBe(false);
  });

  it("should revive an answer when the decision content comes back", () => {
    const edited = inventoryOf({ decisionDigest: "0000000000000000" });
    expect(isCurrentAnswer({ answer: STORED_ANSWER, inventory: edited })).toBe(
      false,
    );
    expect(
      isCurrentAnswer({ answer: STORED_ANSWER, inventory: inventoryOf() }),
    ).toBe(true);
  });

  it("should name a decision still asked whose answer stopped applying", () => {
    const inputs = {
      version: 1,
      revision: 4,
      answers: [STORED_ANSWER],
    } as const;

    expect(
      supersededDecisionIds({
        inputs,
        inventory: inventoryOf({ decisionDigest: "0000000000000000" }),
      }),
    ).toEqual([DECISION_ID]);
  });

  it("should name no decision whose answer is still current", () => {
    const inputs = {
      version: 1,
      revision: 4,
      answers: [STORED_ANSWER],
    } as const;

    expect(supersededDecisionIds({ inputs, inventory: INVENTORY })).toEqual([]);
  });

  // A decision the plan dropped has no card left, so naming it would ask the
  // browser to explain an answer beside nothing.
  it("should name no decision the plan stopped asking altogether", () => {
    const inputs = {
      version: 1,
      revision: 4,
      answers: [STORED_ANSWER],
    } as const;

    expect(
      supersededDecisionIds({
        inputs,
        inventory: inventoryOf({ decisionId: "decision-reworded" }),
      }),
    ).toEqual([]);
  });

  it("should show only the current answers of a record it never edits", () => {
    const inputs = {
      version: 1,
      revision: 4,
      answers: [
        STORED_ANSWER,
        {
          ...STORED_ANSWER,
          decisionId: "decision-rollback-plan",
          optionId: "decision-rollback-plan-option-manual",
        },
      ],
    } as const;

    expect(currentAnswers({ inputs, inventory: INVENTORY })).toEqual([
      STORED_ANSWER,
    ]);
    expect(inputs.answers).toHaveLength(2);
  });
});
