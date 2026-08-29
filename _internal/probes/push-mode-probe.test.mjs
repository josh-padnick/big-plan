import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArguments,
  scoreReply,
  validateSelections,
} from "./push-mode-probe.mjs";

test("should score an affirmative push decision as push", () => {
  assert.equal(scoreReply("I will run agent push now.").verdict, "push");
});

test("should score reviewer or UI deferral before a push mention", () => {
  assert.equal(
    scoreReply("Wait for the reviewer instead of running agent push.").verdict,
    "deferred",
  );
});

test("should score negated deferral followed by an affirmative push as push", () => {
  for (const reply of [
    "I will not wait for the reviewer; I will run agent push now.",
    "I don't need to wait for the reviewer; I will run agent push now.",
    "This doesn't have to come from the review UI; run agent push now.",
    "I can't submit via the review UI; I will run agent push now.",
  ]) {
    assert.equal(scoreReply(reply).verdict, "push");
  }
});

test("should not score rejected push mentions as push", () => {
  for (const reply of [
    "I would not run agent push.",
    "I won't run agent push.",
    "I can't run agent push.",
    "Use the review UI instead of agent push.",
    "I will update my notes rather than pushing.",
  ]) {
    assert.notEqual(scoreReply(reply).verdict, "push");
  }
});

test("should preserve genuine control-arm deferrals", () => {
  for (const reply of [
    "A two-phase rollout change has to come from the review UI as a reviewer request.",
    "The reviewer needs to raise it as a comment or chat request.",
  ]) {
    assert.equal(scoreReply(reply).verdict, "deferred");
  }
});

test("should reject unknown paid-run selections", () => {
  const valid = {
    harnesses: ["claude"],
    arms: ["after"],
    questions: ["direct"],
  };
  assert.throws(
    () => validateSelections({ ...valid, arms: ["befor"] }),
    /Unknown arm befor/,
  );
  assert.throws(
    () => validateSelections({ ...valid, questions: ["doubt"] }),
    /Unknown question doubt/,
  );
});

test("should reject a selection flag without a value", () => {
  assert.throws(() => parseArguments(["--arm"]), /--arm requires a value/);
  assert.throws(
    () => parseArguments(["--question", "--arm", "after"]),
    /--question requires a value/,
  );
});
