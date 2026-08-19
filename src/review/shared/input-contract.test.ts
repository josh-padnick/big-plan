// Proves the one arithmetic that turns a review's expected inputs into a
// judgment about whether the plan is ready.

import { describe, expect, it } from "vitest";
import { reviewInputStanding, type ReviewInput } from "./input-contract.js";

const input = (overrides: Partial<ReviewInput> = {}): ReviewInput => ({
  inputId: "decision-one",
  label: "Which release path?",
  isCritical: false,
  state: "unanswered",
  detail: "No answer recorded",
  ...overrides,
});

describe("reviewInputStanding", () => {
  it("should count answered, open, and stale inputs separately", () => {
    expect(
      reviewInputStanding([
        input({ inputId: "a", state: "answered" }),
        input({ inputId: "b", state: "unanswered" }),
        input({ inputId: "c", state: "stale" }),
      ]),
    ).toEqual({
      total: 3,
      answered: 1,
      open: 2,
      stale: 1,
      criticalOpen: 0,
      isSettled: false,
    });
  });

  it("should count a stale critical input as critically open", () => {
    expect(
      reviewInputStanding([
        input({ inputId: "a", isCritical: true, state: "stale" }),
        input({ inputId: "b", isCritical: true, state: "answered" }),
        input({ inputId: "c", state: "unanswered" }),
      ]).criticalOpen,
    ).toBe(1);
  });

  it("should call a contract settled only when every input is answered", () => {
    expect(
      reviewInputStanding([
        input({ inputId: "a", state: "answered" }),
        input({ inputId: "b", state: "answered" }),
      ]).isSettled,
    ).toBe(true);
  });

  it("should refuse to call an empty contract settled", () => {
    expect(reviewInputStanding([])).toEqual({
      total: 0,
      answered: 0,
      open: 0,
      stale: 0,
      criticalOpen: 0,
      isSettled: false,
    });
  });
});
