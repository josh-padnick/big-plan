// Proves the npm-audit policy classifies every audit outcome into the one
// bucket that decides the gate: a high/critical report is a terminal POLICY
// finding, a registry/transport error is RETRYABLE, a clean report PASSES, and
// anything else fails closed as UNUSABLE. The security-critical case is that a
// policy finding is never mistaken for infrastructure trouble, and that a
// present-but-non-transport error is never rescued into a retry.

import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAuditResult, isTransportError } from "./policy.mjs";

/** A valid npm-audit report with the given severity counts. */
const report = (counts, vulnerabilities = {}) =>
  JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities,
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
  });

/** An npm-audit `--json` failure object. */
const errorReport = (code, summary) =>
  JSON.stringify({ error: { code, summary, detail: "detail" } });

test("a clean report with no gating advisory passes", () => {
  const outcome = classifyAuditResult({ status: 0, stdout: report({}) });
  assert.equal(outcome.kind, "clean");
});

test("moderate and low advisories do not gate", () => {
  const outcome = classifyAuditResult({
    status: 1,
    stdout: report({ low: 3, moderate: 2, total: 5 }),
  });
  assert.equal(outcome.kind, "clean");
});

test("a high advisory is a terminal policy finding", () => {
  const outcome = classifyAuditResult({
    status: 1,
    stdout: report(
      { high: 1, total: 1 },
      { "bad-pkg": { name: "bad-pkg", severity: "high" } },
    ),
  });
  assert.equal(outcome.kind, "policy");
  assert.equal(outcome.counts.high, 1);
  assert.deepEqual(outcome.advisories, ["bad-pkg"]);
});

test("a critical advisory is a terminal policy finding", () => {
  const outcome = classifyAuditResult({
    status: 1,
    stdout: report(
      { critical: 2, total: 2 },
      {
        "pkg-a": { name: "pkg-a", severity: "critical" },
        "pkg-b": { name: "pkg-b", severity: "critical" },
      },
    ),
  });
  assert.equal(outcome.kind, "policy");
  assert.equal(outcome.counts.critical, 2);
  assert.deepEqual(outcome.advisories, ["pkg-a", "pkg-b"]);
});

test("high alongside moderate still gates on the high count", () => {
  const outcome = classifyAuditResult({
    status: 1,
    stdout: report({ moderate: 5, high: 1, total: 6 }),
  });
  assert.equal(outcome.kind, "policy");
});

test("a network error is a retryable transport failure", () => {
  const outcome = classifyAuditResult({
    status: 1,
    stdout: errorReport("ENETUNREACH", "connect ENETUNREACH registry"),
  });
  assert.equal(outcome.kind, "transport");
  assert.equal(outcome.code, "ENETUNREACH");
});

test("a registry 5xx is a retryable transport failure", () => {
  const outcome = classifyAuditResult({
    status: 1,
    stdout: errorReport("E503", "503 Service Unavailable"),
  });
  assert.equal(outcome.kind, "transport");
});

test("a registry 429 rate limit is a retryable transport failure", () => {
  const outcome = classifyAuditResult({
    status: 1,
    stdout: errorReport("E429", "429 Too Many Requests"),
  });
  assert.equal(outcome.kind, "transport");
});

test("a non-transport error fails closed as unusable, never retried", () => {
  const outcome = classifyAuditResult({
    status: 1,
    stdout: errorReport("EACCES", "permission denied"),
  });
  assert.equal(outcome.kind, "unusable");
});

test("unparseable output fails closed as unusable", () => {
  const outcome = classifyAuditResult({
    status: 1,
    stdout: "npm warn ...\nnot json at all",
  });
  assert.equal(outcome.kind, "unusable");
});

test("empty output fails closed as unusable", () => {
  const outcome = classifyAuditResult({ status: null, stdout: "" });
  assert.equal(outcome.kind, "unusable");
});

test("valid JSON that is not an object fails closed as unusable", () => {
  const outcome = classifyAuditResult({ status: 0, stdout: "42" });
  assert.equal(outcome.kind, "unusable");
});

test("a report with neither counts nor error fails closed as unusable", () => {
  const outcome = classifyAuditResult({
    status: 0,
    stdout: JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }),
  });
  assert.equal(outcome.kind, "unusable");
});

test("isTransportError matches known network and status codes", () => {
  for (const code of [
    "ENETUNREACH",
    "ECONNRESET",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
    "E500",
    "E503",
    "E429",
    "E408",
  ]) {
    assert.equal(isTransportError(code, "x"), true, code);
  }
});

test("isTransportError rejects a present non-transport code even with network-ish text", () => {
  // A present but non-transport code must not be rescued by the text fallback.
  assert.equal(isTransportError("EACCES", "socket hang up"), false);
});

test("isTransportError falls back to text only when no code is present", () => {
  assert.equal(isTransportError(undefined, "socket hang up"), true);
  assert.equal(isTransportError(null, "network timeout at registry"), true);
  assert.equal(isTransportError(undefined, "some unrelated message"), false);
});
