import assert from "node:assert/strict";
import test from "node:test";

import {
  namesPushCommand,
  parseArguments,
  scoreReply,
  validateSelections,
} from "./push-mode-probe.mjs";

test("should score a structured push command as push", () => {
  assert.equal(
    scoreReply(
      "I will originate the change.\nNEXT_COMMAND: big-plan agent push",
    ).verdict,
    "push",
  );
});

test("should score NONE as other", () => {
  assert.equal(
    scoreReply("I would not run agent push.\nNEXT_COMMAND: NONE").verdict,
    "other",
  );
});

test("should score a different structured command as other", () => {
  assert.equal(
    scoreReply("I will keep waiting.\nNEXT_COMMAND: big-plan agent next --wait")
      .verdict,
    "other",
  );
});

test("should use the last structured command", () => {
  assert.equal(
    scoreReply(
      "NEXT_COMMAND: NONE\nI reconsidered.\nNEXT_COMMAND: big-plan agent push",
    ).verdict,
    "push",
  );
});

test("should report a missing structured command as a harness error", () => {
  assert.deepEqual(
    scoreReply("I would run agent push, but omitted the field."),
    {
      nextCommand: null,
      reachedForPush: false,
      harnessError: true,
      verdict: "harness_error",
    },
  );
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

test("should default to control and after arms", () => {
  assert.deepEqual(parseArguments([]).arms, ["control", "after"]);
});

test("should reject invalid trial counts", () => {
  for (const value of ["nope", "Infinity", "1.5", "0", "-1"]) {
    assert.throws(
      () => parseArguments(["--trials", value]),
      new RegExp(`Invalid --trials value ${value.replace(".", "\\.")}`),
    );
  }
});

test("should not score a sentence that rejects the push command as push", () => {
  assert.equal(
    scoreReply("I will wait.\nNEXT_COMMAND: do not run agent push").verdict,
    "other",
  );
});

test("should score a launched push invocation as push", () => {
  assert.equal(
    namesPushCommand(
      "node '/repo/bin/big-plan.mjs' agent push '/p/plan.mdx' --about 'why'",
    ),
    true,
  );
});

test("should not score prose mentioning the push command as a command", () => {
  assert.equal(namesPushCommand("I will not use agent push here"), false);
});

test("should not score a different subcommand as push", () => {
  assert.equal(
    namesPushCommand("node bin/big-plan.mjs agent next plan.mdx --wait"),
    false,
  );
});
