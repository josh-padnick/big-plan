import assert from "node:assert/strict";
import test from "node:test";

import { reconstructBaselinePrompt } from "./capture-connector-prompt.mjs";

test("should capture the parent revision as the default baseline", async () => {
  const currentPrompt = `Plan: example.mdx

## Your two modes

Run agent push.

Work in the plan's repository.

Continue with the work-item loop.`;
  const baseline = await reconstructBaselinePrompt(currentPrompt, "HEAD^");

  assert.match(baseline, /Operator-initiated plan changes/);
  assert.doesNotMatch(baseline, /## Your two modes/);
});
