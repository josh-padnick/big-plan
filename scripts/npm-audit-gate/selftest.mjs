// Workflow-level proof that the runtime-dependency audit gate fails closed.
//
// A unit test can check classification in isolation, but the thing that
// actually protects the build is the shipped entrypoint's exit code. This
// selftest drives that real entrypoint end to end - spawning
// audit-runtime-dependencies.mjs exactly as CI does, only with recorded audit
// output substituted through the --fixture seam - and asserts the exit code and
// the decision trail for the three outcomes that matter:
//
//   1. POLICY finding (a high/critical advisory): the process exits NON-ZERO on
//      the first attempt and never retries. This is the CWE-693 regression; if
//      the gate ever retried a policy finding into a pass, this scenario turns
//      the CI job red.
//   2. TRANSIENT transport error then a clean audit: the process retries and
//      exits ZERO. This proves a real registry blip is still tolerated.
//   3. PERSISTENT transport error: the process retries to the attempt budget and
//      then exits NON-ZERO, failing closed rather than hanging or passing.
//
// The CI `audit-gate-selftest` job runs this file. It exits 0 only when all
// three scenarios behave correctly, so a regression in either direction -
// retrying a policy finding, or refusing to retry a transport blip - fails the
// job.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entrypoint = path.join(here, "audit-runtime-dependencies.mjs");
const fixtures = (name) => path.join(here, "fixtures", name);

/** Runs the real gate entrypoint against a fixture and returns exit + stdout. */
const runGate = (fixtureName) => {
  const result = spawnSync(
    process.execPath,
    [
      entrypoint,
      `--fixture=${fixtures(fixtureName)}`,
      "--max-attempts=3",
      // Keep the simulated retries instant; production keeps its 5s delay.
      "--retry-delay-ms=0",
    ],
    { encoding: "utf8" },
  );
  if (result.error) {
    throw result.error;
  }
  return { code: result.status, stdout: result.stdout ?? "" };
};

const failures = [];

/** Records a scenario's checks and prints its transcript for the CI log. */
const scenario = (title, fixtureName, checks) => {
  const { code, stdout } = runGate(fixtureName);
  process.stdout.write(`\n${"=".repeat(78)}\n${title}\n${"-".repeat(78)}\n`);
  process.stdout.write(`${stdout.trimEnd()}\n`);
  process.stdout.write(`[exit code ${code}]\n`);
  for (const check of checks) {
    const ok = check.assert({ code, stdout });
    process.stdout.write(`  ${ok ? "PASS" : "FAIL"}  ${check.label}\n`);
    if (!ok) {
      failures.push(`${title}: ${check.label}`);
    }
  }
};

scenario(
  "Scenario 1: a high/critical advisory must FAIL CLOSED and never retry",
  "policy",
  [
    {
      label: "exit code is non-zero (gate fails the build)",
      assert: ({ code }) => code !== 0,
    },
    {
      label: "classified as a policy finding",
      assert: ({ stdout }) => /POLICY FINDING/.test(stdout),
    },
    {
      label: "did NOT retry (attempt 2 never runs)",
      assert: ({ stdout }) => !/audit attempt 2/.test(stdout),
    },
  ],
);

scenario(
  "Scenario 2: a transient transport error must RETRY, then pass on a clean audit",
  "transient",
  [
    {
      label: "exit code is zero (gate passes)",
      assert: ({ code }) => code === 0,
    },
    {
      label: "retried after the transport error (attempt 2 runs)",
      assert: ({ stdout }) => /audit attempt 2/.test(stdout),
    },
    {
      label: "reported the retry as a transport error",
      assert: ({ stdout }) => /transport error, retryable/.test(stdout),
    },
  ],
);

scenario(
  "Scenario 3: a persistent transport error must retry to the budget, then FAIL CLOSED",
  "persistent",
  [
    {
      label: "exit code is non-zero (gate fails closed)",
      assert: ({ code }) => code !== 0,
    },
    {
      label: "retried to the final attempt (attempt 3 runs)",
      assert: ({ stdout }) => /audit attempt 3/.test(stdout),
    },
    {
      label: "failed closed rather than passing",
      assert: ({ stdout }) => /Failing closed|FAIL \(transport\)/.test(stdout),
    },
  ],
);

process.stdout.write(`\n${"=".repeat(78)}\n`);
if (failures.length === 0) {
  process.stdout.write(
    "audit-gate selftest: PASS - the gate fails closed on a policy finding and retries only transport errors.\n",
  );
  process.exitCode = 0;
} else {
  process.stdout.write(
    `audit-gate selftest: FAIL - ${failures.length} assertion(s) did not hold:\n`,
  );
  for (const failure of failures) {
    process.stdout.write(`  - ${failure}\n`);
  }
  process.stderr.write("::error::audit-gate selftest failed\n");
  process.exitCode = 1;
}
