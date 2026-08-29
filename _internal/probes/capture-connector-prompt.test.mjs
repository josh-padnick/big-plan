import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

import {
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
