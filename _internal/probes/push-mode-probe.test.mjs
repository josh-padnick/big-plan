import assert from "node:assert/strict";
import test from "node:test";

import { scoreReply } from "./push-mode-probe.mjs";

test("should score an affirmative push decision as push", () => {
  assert.equal(scoreReply("I will run agent push now.").verdict, "push");
});

test("should score reviewer or UI deferral before a push mention", () => {
  assert.equal(
    scoreReply("Wait for the reviewer instead of running agent push.").verdict,
    "deferred",
  );
});

test("should not score rejected push mentions as push", () => {
  for (const reply of [
    "I would not run agent push.",
    "Use the review UI instead of agent push.",
    "I will update my notes rather than pushing.",
  ]) {
    assert.notEqual(scoreReply(reply).verdict, "push");
  }
});
