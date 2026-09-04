// The npm-audit policy: what the runtime-dependency audit gate enforces, and
// how one audit outcome is classified. This module is pure - it neither spawns
// npm nor decides retries - so every rule here is unit-testable in isolation.
// The runner in audit-runtime-dependencies.mjs owns spawning, retrying, and the
// process exit code; it asks this module one question per attempt: "what does
// this audit result mean?"
//
// THE GATE. A runtime dependency (production `dependencies`, resolved with
// `--omit=dev`) with a HIGH or CRITICAL advisory fails the build. Moderate,
// low, and info advisories do not gate; they are reported by `npm audit` but
// this gate lets them pass, which matches the reverted single-line command's
// `--audit-level=high`.
//
// WHY CLASSIFICATION EXISTS (CWE-693). A prior version wrapped `npm audit` in a
// blind retry loop that exited 0 the moment any attempt returned 0. Because the
// audit runs with `--no-package-lock`, dependency resolution can differ between
// attempts, so a genuine high/critical advisory could slip through on a lucky
// retry: a protection-mechanism failure. The fix is to distinguish two outcomes
// that a raw exit code conflates:
//
//   - The audit RAN and reached a verdict. Its JSON report carries
//     `metadata.vulnerabilities` counts. This is a POLICY result: clean when no
//     high/critical advisory is present, a policy FINDING when one is. A policy
//     finding is TERMINAL - it fails the gate and is never retried, because
//     retrying a real advisory is exactly the hole above.
//   - The audit COULD NOT RUN because the registry was unreachable: a network,
//     socket, DNS, timeout, or registry 5xx/429 error. `npm audit --json`
//     reports this as an `{ "error": { code, summary } }` object rather than a
//     vulnerability report. This is the ONLY outcome the runner may retry.
//
// Any third shape - output that is neither a vulnerability report nor a
// recognized transport error - is UNUSABLE. It fails closed and is not retried:
// it can never be a hidden policy finding (a finding always arrives as a valid
// report with counts), and passing or retrying on an unrecognized state is how
// a gate quietly stops protecting. Only a positively identified transport error
// earns a retry.

/** Severities at or above which a runtime-dependency advisory fails the gate. */
export const GATING_SEVERITIES = Object.freeze(["high", "critical"]);

// The audit invocation the runner spawns. It is the reverted single-line
// command plus `--json`, so the gate audits exactly the same runtime-dependency
// path (`--omit=dev`, `--no-package-lock`) at the same threshold, and reads a
// machine-readable report instead of a human one. `--audit-level=high` only
// influences npm's own exit code; this module derives the verdict from the
// reported counts, so the threshold lives in GATING_SEVERITIES regardless.
export const AUDIT_COMMAND = Object.freeze({
  command: "npm",
  args: [
    "audit",
    "--no-package-lock",
    "--omit=dev",
    "--audit-level=high",
    "--json",
  ],
});

// npm error codes that mean "could not reach or complete the request to the
// registry": DNS, socket, connection, and timeout failures. Registry HTTP 5xx
// and 429/408 responses arrive as `E<status>` codes and are matched separately.
const TRANSPORT_ERROR_CODES = new Set([
  "ENETUNREACH",
  "ENETDOWN",
  "EHOSTUNREACH",
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EPIPE",
  "EPROTO",
  "ERR_SOCKET_TIMEOUT",
  "ERR_SOCKET_CONNECTION_TIMEOUT",
  "FETCH_ERROR",
]);

// A registry HTTP status npm surfaces as `E<status>`: 5xx (server error),
// 429 (rate limited), or 408 (request timeout). All are transient by nature.
const TRANSPORT_STATUS_CODE = /^E(5\d\d|429|408)$/;

// Last-resort text signature for a transport failure whose structured code npm
// did not set. Kept narrow so it never matches an advisory title.
const TRANSPORT_TEXT =
  /\b(ENETUNREACH|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang ?up|network timeout|request to .* failed|registry returned 5\d\d|getaddrinfo)\b/i;

/**
 * Reports whether an npm-audit error describes a registry/transport failure the
 * runner may retry. Takes the error's `code` and its human `summary`.
 */
export const isTransportError = (code, summary) => {
  if (typeof code === "string") {
    const upper = code.toUpperCase();
    if (TRANSPORT_ERROR_CODES.has(upper) || TRANSPORT_STATUS_CODE.test(upper)) {
      return true;
    }
  }
  // Only fall back to the text when npm gave no code at all. A present but
  // non-transport code (a configuration error, say) must fail closed, not be
  // rescued by a phrase that happens to appear in its detail.
  if ((code === undefined || code === null) && typeof summary === "string") {
    return TRANSPORT_TEXT.test(summary);
  }
  return false;
};

/** Reads the high/critical counts from a parsed audit report, defaulting to 0. */
const gatingCounts = (report) => {
  const counts = report?.metadata?.vulnerabilities ?? {};
  const result = {};
  let gating = 0;
  for (const severity of GATING_SEVERITIES) {
    const value = Number.isFinite(counts[severity]) ? counts[severity] : 0;
    result[severity] = value;
    gating += value;
  }
  return { bySeverity: result, gating };
};

/** Names the packages whose own severity is at or above the gate threshold. */
const gatingAdvisories = (report) => {
  const vulnerabilities = report?.vulnerabilities;
  if (vulnerabilities === null || typeof vulnerabilities !== "object") {
    return [];
  }
  const names = [];
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (GATING_SEVERITIES.includes(entry?.severity)) {
      names.push(name);
    }
  }
  return names.sort();
};

/**
 * Classifies one audit attempt into exactly one outcome. Takes the attempt's
 * process `status` (exit code, or null when it never exited), `stdout`, and
 * `stderr`. Returns a discriminated result:
 *
 *   { kind: "clean",     counts }                 -> gate passes
 *   { kind: "policy",    counts, advisories }     -> gate fails, TERMINAL
 *   { kind: "transport", code, reason }           -> gate may RETRY this attempt
 *   { kind: "unusable",  reason }                 -> gate fails closed, TERMINAL
 *
 * The verdict is derived from the report content, never from the exit code
 * alone, because the exit code cannot tell a real advisory apart from an
 * unreachable registry.
 */
export const classifyAuditResult = ({ status, stdout, stderr } = {}) => {
  const text = typeof stdout === "string" ? stdout.trim() : "";
  if (text === "") {
    return {
      kind: "unusable",
      reason: `npm audit produced no output to classify (exit ${formatStatus(status)}).${stderrTail(stderr)}`,
    };
  }

  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return {
      kind: "unusable",
      reason: `npm audit output was not valid JSON (exit ${formatStatus(status)}), so its verdict cannot be trusted.${stderrTail(stderr)}`,
    };
  }

  if (report === null || typeof report !== "object") {
    return {
      kind: "unusable",
      reason:
        "npm audit output was valid JSON but not an object, so it carries no verdict.",
    };
  }

  // A registry/transport failure: npm reports it as an error object instead of
  // a vulnerability report. This is the only retryable shape.
  if (report.error !== undefined && report.error !== null) {
    const code = report.error.code;
    const summary =
      report.error.summary ?? report.error.detail ?? "no summary provided";
    if (isTransportError(code, summary)) {
      return {
        kind: "transport",
        code: code ?? null,
        reason: `npm audit could not reach the registry (${code ?? "no code"}): ${summary}`,
      };
    }
    return {
      kind: "unusable",
      reason: `npm audit failed with a non-transport error (${code ?? "no code"}): ${summary}`,
    };
  }

  // A vulnerability report: the audit ran and reached a verdict. Decide it from
  // the counts, so a finding can never be mistaken for infrastructure trouble.
  if (report.metadata?.vulnerabilities !== undefined) {
    const counts = gatingCounts(report);
    if (counts.gating > 0) {
      return {
        kind: "policy",
        counts: counts.bySeverity,
        advisories: gatingAdvisories(report),
      };
    }
    return { kind: "clean", counts: counts.bySeverity };
  }

  return {
    kind: "unusable",
    reason:
      "npm audit output has neither a vulnerability report nor an error, so its verdict is unknown.",
  };
};

const formatStatus = (status) =>
  typeof status === "number" ? String(status) : "no exit code";

const stderrTail = (stderr) => {
  if (typeof stderr !== "string" || stderr.trim() === "") {
    return "";
  }
  const trimmed = stderr.trim();
  const tail = trimmed.length > 500 ? `...${trimmed.slice(-500)}` : trimmed;
  return ` stderr: ${tail}`;
};
