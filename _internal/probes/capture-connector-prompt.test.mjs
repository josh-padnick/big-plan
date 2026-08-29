import assert from "node:assert/strict";
import test from "node:test";

import {
  reconstructBaselinePrompt,
  resolveBaselineRevision,
} from "./capture-connector-prompt.mjs";

test("should reconstruct the default-branch baseline", async () => {
  const currentPrompt = `Plan: example.mdx

## Your two modes

Run agent push.

Work in the plan's repository.

Continue with the work-item loop.`;
  const baselineRev = await resolveBaselineRevision();
  const baseline = await reconstructBaselinePrompt(currentPrompt, baselineRev);

  assert.match(baseline, /Operator-initiated plan changes/);
  assert.doesNotMatch(baseline, /## Your two modes/);
});
