import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

import {
  readBaselineRevision,
  reconstructBaselinePrompt,
  resolveBaselineRevision,
} from "./capture-connector-prompt.mjs";

const execFileAsync = promisify(execFile);

test("should reconstruct an explicit pre-feature baseline", async () => {
  const currentPrompt = `Plan: example.mdx

## Your two modes

Run agent push.

Work in the plan's repository.

Continue with the work-item loop.`;
  const baseline = await reconstructBaselinePrompt(
    currentPrompt,
    "28ce1bf4ba2bbc6f551f21b7e72364c196223c68",
  );

  assert.match(baseline, /Operator-initiated plan changes/);
  assert.doesNotMatch(baseline, /## Your two modes/);
});

test("should prefer an explicit baseline revision", async () => {
  assert.equal(await resolveBaselineRevision("pre-feature"), "pre-feature");
});

test("should resolve the default-branch merge base", async () => {
  const baselineRev = await resolveBaselineRevision();
  let expected;
  try {
    ({ stdout: expected } = await execFileAsync("git", [
      "merge-base",
      "HEAD",
      "origin/main",
    ]));
  } catch {
    ({ stdout: expected } = await execFileAsync("git", [
      "merge-base",
      "HEAD",
      "main",
    ]));
  }
  assert.equal(baselineRev, expected.trim());
});

test("should read no baseline revision when the flag is absent", () => {
  assert.equal(
    readBaselineRevision([
      "node",
      "capture-connector-prompt.mjs",
      "--baseline",
    ]),
    undefined,
  );
});

test("should read the revision that follows the baseline flag", () => {
  assert.equal(
    readBaselineRevision(["node", "script.mjs", "--baseline-rev", "abc1234"]),
    "abc1234",
  );
});

test("should refuse a baseline flag given no revision", () => {
  assert.throws(
    () => readBaselineRevision(["node", "script.mjs", "--baseline-rev"]),
    /requires a revision/,
  );
  assert.throws(
    () =>
      readBaselineRevision([
        "node",
        "script.mjs",
        "--baseline-rev",
        "--baseline",
      ]),
    /requires a revision/,
  );
});
