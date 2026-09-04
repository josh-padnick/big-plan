// Proves the retry orchestration honors the one rule that closes the CWE-693
// hole: only a transport failure is retried. A policy finding fails on the
// first attempt with no retry; a transport blip retries and can then pass; a
// persistent transport failure retries to the budget and fails closed; an
// unusable result fails closed without retry; and a policy finding that appears
// AFTER a transport retry still terminates immediately instead of being retried
// away.

import assert from "node:assert/strict";
import { test } from "node:test";
import { runAuditGate } from "./audit-runtime-dependencies.mjs";

const CLEAN = { status: 0, stdout: JSON.stringify(countsReport({})) };
const POLICY = {
  status: 1,
  stdout: JSON.stringify(countsReport({ high: 1, total: 1 })),
};
const TRANSPORT = {
  status: 1,
  stdout: JSON.stringify({
    error: { code: "ENETUNREACH", summary: "connect ENETUNREACH" },
  }),
};
const UNUSABLE = { status: 1, stdout: "not json" };

function countsReport(counts) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: {
        info: 0,
        low: 0,
        moderate: 0,
        high: 0,
        critical: 0,
        total: 0,
        ...counts,
      },
    },
  };
}

/** Builds a runAttempt that returns the given results in order, and a sleep spy. */
const harness = (results) => {
  const calls = [];
  const sleeps = [];
  const runAttempt = (attempt) => {
    calls.push(attempt);
    return Promise.resolve(results[attempt - 1]);
  };
  const sleep = (ms) => {
    sleeps.push(ms);
    return Promise.resolve();
  };
  return { runAttempt, sleep, calls, sleeps };
};

test("a clean audit passes on the first attempt", async () => {
  const h = harness([CLEAN]);
  const gate = await runAuditGate({ ...h, maxAttempts: 3 });
  assert.equal(gate.ok, true);
  assert.equal(gate.attempts, 1);
  assert.deepEqual(h.calls, [1]);
  assert.equal(h.sleeps.length, 0);
});

test("a policy finding fails on attempt 1 and is never retried", async () => {
  const h = harness([POLICY, CLEAN, CLEAN]);
  const gate = await runAuditGate({ ...h, maxAttempts: 3 });
  assert.equal(gate.ok, false);
  assert.equal(gate.outcome.kind, "policy");
  assert.equal(gate.attempts, 1);
  assert.equal(gate.retried, false);
  // The decisive assertion: only one attempt ran, so no lucky retry is possible.
  assert.deepEqual(h.calls, [1]);
  assert.equal(h.sleeps.length, 0);
});

test("a transient transport error retries and then passes", async () => {
  const h = harness([TRANSPORT, CLEAN]);
  const gate = await runAuditGate({ ...h, maxAttempts: 3 });
  assert.equal(gate.ok, true);
  assert.equal(gate.attempts, 2);
  assert.equal(gate.retried, true);
  assert.deepEqual(h.calls, [1, 2]);
  assert.equal(h.sleeps.length, 1);
});

test("a persistent transport error retries to the budget then fails closed", async () => {
  const h = harness([TRANSPORT, TRANSPORT, TRANSPORT]);
  const gate = await runAuditGate({ ...h, maxAttempts: 3 });
  assert.equal(gate.ok, false);
  assert.equal(gate.outcome.kind, "transport");
  assert.equal(gate.attempts, 3);
  assert.deepEqual(h.calls, [1, 2, 3]);
  // Slept between attempts, but not after the final one.
  assert.equal(h.sleeps.length, 2);
});

test("an unusable result fails closed without retry", async () => {
  const h = harness([UNUSABLE, CLEAN]);
  const gate = await runAuditGate({ ...h, maxAttempts: 3 });
  assert.equal(gate.ok, false);
  assert.equal(gate.outcome.kind, "unusable");
  assert.equal(gate.attempts, 1);
  assert.deepEqual(h.calls, [1]);
});

test("a policy finding after a transport retry still terminates, not retried away", async () => {
  // The exact CWE-693 shape: attempt 1 could not run, attempt 2 finds a real
  // advisory. The advisory must fail the gate at attempt 2, not be retried.
  const h = harness([TRANSPORT, POLICY, CLEAN]);
  const gate = await runAuditGate({ ...h, maxAttempts: 3 });
  assert.equal(gate.ok, false);
  assert.equal(gate.outcome.kind, "policy");
  assert.equal(gate.attempts, 2);
  assert.deepEqual(h.calls, [1, 2]);
});
