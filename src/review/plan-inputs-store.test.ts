// Proves the durable decision-answer record accepts only its versioned shape
// and keeps one current mutation per decision.

import { describe, expect, it } from "vitest";
import {
  applyStagedInputMutation,
  validateStagedInputMutation,
  validateStagedInputs,
} from "./plan-inputs-store.js";

const FIRST_ANSWER = {
  decisionId: "decision-release-path",
  optionId: "decision-release-path-option-gradual",
  optionTitle: "Gradual",
  prompt: "Which release path?",
  premiseSnapshot: "0123456789abcdef",
} as const;

describe("staged decision inputs", () => {
  it("should round-trip a valid versioned answer record", () => {
    const stored = {
      version: 1,
      answers: [
        {
          ...FIRST_ANSWER,
          answeredAt: "2026-08-13T17:04:00.000Z",
        },
      ],
    };

    expect(validateStagedInputs(JSON.parse(JSON.stringify(stored)))).toEqual(
      stored,
    );
  });

  it("should reject duplicate answers for one decision", () => {
    expect(() =>
      validateStagedInputs({
        version: 1,
        answers: [
          { ...FIRST_ANSWER, answeredAt: "2026-08-13T17:04:00.000Z" },
          { ...FIRST_ANSWER, answeredAt: "2026-08-13T17:05:00.000Z" },
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
    });

    expect(staged).toMatchObject({
      answer: {
        decisionId: "decision-qué-vía",
        optionId: "decision-qué-vía-option-café",
      },
    });
  });

  it("should replace and retract the current answer for one decision", () => {
    const first = validateStagedInputMutation({
      value: { op: "stage", answer: FIRST_ANSWER },
      now: "2026-08-13T17:04:00.000Z",
    });
    const second = validateStagedInputMutation({
      value: {
        op: "stage",
        answer: {
          ...FIRST_ANSWER,
          optionId: "decision-release-path-option-immediate",
          optionTitle: "Immediate",
        },
      },
      now: "2026-08-13T17:05:00.000Z",
    });
    const retract = validateStagedInputMutation({
      value: { op: "retract", decisionId: FIRST_ANSWER.decisionId },
      now: "2026-08-13T17:06:00.000Z",
    });

    const staged = applyStagedInputMutation({
      inputs: applyStagedInputMutation({
        inputs: { version: 1, answers: [] },
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
});
