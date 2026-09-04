// The runtime-dependency audit gate. CI's lint job runs this as a thin call;
// the script owns the whole decision. It spawns `npm audit` (see policy.mjs for
// the exact command), classifies each attempt, and exits 0 only when the audit
// ran and found no high/critical runtime-dependency advisory.
//
// Retry policy, stated once so it cannot drift: ONLY a confirmed transport /
// registry / network failure is retried. A POLICY finding - the audit ran and
// reported a high/critical advisory - is terminal and fails the build on the
// first attempt; it is never retried, because retrying a real advisory under
// `--no-package-lock` is the CWE-693 hole this gate exists to close. An
// unusable result (output that is neither a report nor a recognized transport
// error) also fails closed without retry. classifyAuditResult() in policy.mjs
// owns which is which; this file owns spawning, the bounded retry, and the exit
// code.
//
// Usage:
//   node scripts/npm-audit-gate/audit-runtime-dependencies.mjs
//   node scripts/npm-audit-gate/audit-runtime-dependencies.mjs --max-attempts=3
//   node scripts/npm-audit-gate/audit-runtime-dependencies.mjs --fixture=<dir>
//
// `--fixture=<dir>` replaces the real `npm audit` spawn with pre-recorded
// attempt results read from `<dir>/attempt-<n>.json` (each `{ status, stdout,
// stderr }`). It exists only so selftest.mjs can drive the real entrypoint end
// to end through both the fail-closed and the retry paths; the CI gate step
// passes no such flag, so the flag can never weaken a real run.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_COMMAND, classifyAuditResult } from "./policy.mjs";

export const DEFAULT_MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5000;

/**
 * Runs the audit gate over at most `maxAttempts` attempts, retrying only
 * transport failures. Pure with respect to its injected collaborators:
 *   - runAttempt(attemptNumber) -> { status, stdout, stderr }
 *   - sleep(ms) -> Promise, called between retries
 *   - log(message) -> void, receives one line per notable event
 * Returns { ok, outcome, attempts, retried }.
 */
export const runAuditGate = async ({
  runAttempt,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = RETRY_DELAY_MS,
  sleep = defaultSleep,
  log = () => {},
}) => {
  let lastOutcome = null;
  let retried = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    log(`audit attempt ${attempt} of ${maxAttempts}: running npm audit`);
    const result = await runAttempt(attempt);
    const outcome = classifyAuditResult(result);
    lastOutcome = outcome;

    if (outcome.kind === "clean") {
      log(
        `audit attempt ${attempt}: clean - no high or critical runtime-dependency advisory`,
      );
      return { ok: true, outcome, attempts: attempt, retried };
    }

    if (outcome.kind === "policy") {
      // Terminal on purpose: a real advisory must never be retried away.
      log(
        `audit attempt ${attempt}: POLICY FINDING - ${describePolicy(outcome)}. This is terminal; not retrying.`,
      );
      return { ok: false, outcome, attempts: attempt, retried };
    }

    if (outcome.kind === "transport") {
      if (attempt < maxAttempts) {
        retried = true;
        log(
          `audit attempt ${attempt}: transport error, retryable - ${outcome.reason}. Retrying in ${retryDelayMs}ms.`,
        );
        await sleep(retryDelayMs);
        continue;
      }
      log(
        `audit attempt ${attempt}: transport error on the final attempt - ${outcome.reason}. Failing closed.`,
      );
      return { ok: false, outcome, attempts: attempt, retried };
    }

    // Unusable: fail closed without retry.
    log(
      `audit attempt ${attempt}: unusable result - ${outcome.reason}. Failing closed; not retrying.`,
    );
    return { ok: false, outcome, attempts: attempt, retried };
  }

  return { ok: false, outcome: lastOutcome, attempts: maxAttempts, retried };
};

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Spawns the real `npm audit`, capturing stdout even when npm exits non-zero. */
const spawnNpmAudit = () =>
  new Promise((resolve) => {
    execFile(
      AUDIT_COMMAND.command,
      AUDIT_COMMAND.args,
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") {
          // The process never ran (npm missing) or was killed by a signal.
          // Surface it as empty output so classification calls it unusable and
          // the gate fails closed.
          resolve({
            status: null,
            stdout: "",
            stderr: String(error.message ?? error),
          });
          return;
        }
        resolve({
          status: error ? error.code : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );
  });

/**
 * Reads a recorded attempt for the --fixture test seam. Each file is
 * `{ status, stderr, stdout | stdoutJson }`; `stdoutJson` is an object stored
 * readably and serialized here to the string npm would have printed.
 */
const fixtureAttempt = (dir, attempt) => {
  const file = path.join(dir, `attempt-${attempt}.json`);
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const stdout =
    parsed.stdoutJson !== undefined
      ? JSON.stringify(parsed.stdoutJson)
      : (parsed.stdout ?? "");
  return {
    status: parsed.status ?? null,
    stdout,
    stderr: parsed.stderr ?? "",
  };
};

const describePolicy = (outcome) => {
  const counts = Object.entries(outcome.counts ?? {})
    .filter(([, value]) => value > 0)
    .map(([severity, value]) => `${value} ${severity}`)
    .join(", ");
  const packages =
    outcome.advisories && outcome.advisories.length > 0
      ? ` in ${outcome.advisories.join(", ")}`
      : "";
  return `${counts || "high/critical advisory"} runtime-dependency advisory${packages}`;
};

const parseFlag = (argv, name) => {
  const prefix = `--${name}=`;
  const hit = argv.find((argument) => argument.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
};

const main = async () => {
  const argv = process.argv.slice(2);
  const fixtureDir = parseFlag(argv, "fixture");
  const maxAttemptsRaw = parseFlag(argv, "max-attempts");
  const maxAttempts =
    maxAttemptsRaw === undefined
      ? DEFAULT_MAX_ATTEMPTS
      : Number(maxAttemptsRaw);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    process.stderr.write(
      `::error::--max-attempts must be a positive integer, got "${maxAttemptsRaw}"\n`,
    );
    process.exitCode = 1;
    return;
  }
  // Only the selftest passes this, to avoid real 5s sleeps between simulated
  // retries; an unset flag keeps the production RETRY_DELAY_MS.
  const retryDelayRaw = parseFlag(argv, "retry-delay-ms");
  const retryDelayMs =
    retryDelayRaw === undefined ? RETRY_DELAY_MS : Number(retryDelayRaw);
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    process.stderr.write(
      `::error::--retry-delay-ms must be a non-negative number, got "${retryDelayRaw}"\n`,
    );
    process.exitCode = 1;
    return;
  }

  const runAttempt =
    fixtureDir === undefined
      ? spawnNpmAudit
      : (attempt) => fixtureAttempt(fixtureDir, attempt);

  const log = (message) => process.stdout.write(`${message}\n`);

  let gate;
  try {
    gate = await runAuditGate({ runAttempt, maxAttempts, retryDelayMs, log });
  } catch (error) {
    // A collaborator threw (a missing fixture, an unreadable file). Fail closed.
    process.stderr.write(
      `::error::runtime-dependency audit gate could not run: ${String(error?.stack ?? error)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`\n${"=".repeat(78)}\n`);
  if (gate.ok) {
    process.stdout.write(
      `Runtime-dependency audit gate: PASS after ${attemptWord(gate.attempts)}. No high or critical advisory on the runtime dependency path.\n`,
    );
    process.exitCode = 0;
    return;
  }

  const outcome = gate.outcome ?? { kind: "unusable", reason: "no outcome" };
  const headline =
    outcome.kind === "policy"
      ? `a high/critical runtime-dependency advisory (${describePolicy(outcome)})`
      : outcome.kind === "transport"
        ? `a registry/transport failure that persisted across ${attemptWord(gate.attempts)}`
        : `an unusable audit result`;
  process.stdout.write(
    `Runtime-dependency audit gate: FAIL (${outcome.kind}) - ${headline}.\n`,
  );
  if (outcome.reason) {
    process.stdout.write(`Reason: ${outcome.reason}\n`);
  }
  if (outcome.kind === "policy") {
    process.stdout.write(
      "A policy finding is terminal and is never retried. Remove or upgrade the offending runtime dependency, or move it to devDependencies if it is not shipped.\n",
    );
  }
  process.stderr.write(
    `::error::Runtime-dependency audit gate failed (${outcome.kind}).\n`,
  );
  process.exitCode = 1;
};

const attemptWord = (n) => (n === 1 ? "1 attempt" : `${n} attempts`);

// Run main only when invoked as the CLI, so tests can import the exports above
// without triggering a real npm audit.
const invokedAsScript =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  await main();
}
