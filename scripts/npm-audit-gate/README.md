# Runtime-dependency audit gate

See [AGENTS.md](../../AGENTS.md) for repository-wide guidance.

CI's lint job calls this gate to fail the build when a **runtime** dependency
(production `dependencies`, resolved with `--omit=dev`) carries a **high or
critical** advisory. It exists to close a CWE-693 protection-mechanism failure:
a blind retry loop around `npm audit` that exited 0 the moment any attempt
returned 0, so a real advisory could slip through on a lucky retry under
`--no-package-lock`.

## What the gate decides

Each `npm audit` attempt is classified into exactly one outcome, and the outcome
alone decides retry and exit:

| Outcome    | Meaning                                                      | Gate does                |
| ---------- | ------------------------------------------------------------ | ------------------------ |
| clean      | audit ran; no high/critical advisory                         | pass                     |
| **policy** | audit ran; a high/critical advisory is present               | **fail, never retried**  |
| transport  | audit could not reach the registry (network/DNS/5xx/429/...) | retry (bounded)          |
| unusable   | output is neither a report nor a recognized transport error  | fail closed, not retried |

Only a **confirmed transport error** is retried. A **policy finding is
terminal** — retrying a real advisory is the exact hole this gate closes. The
verdict is derived from the audit report's counts, never from the exit code
alone, so a finding can never be mistaken for infrastructure trouble.

## Layout

- `policy.mjs` — the pure policy: the gating threshold, the audit command, and
  `classifyAuditResult`. This file's header owns the full rationale.
- `audit-runtime-dependencies.mjs` — the runnable gate: spawns `npm audit`,
  runs the bounded retry, and owns the process exit code. CI calls it as
  `node scripts/npm-audit-gate/audit-runtime-dependencies.mjs`
  (also `bun run audit-runtime-dependencies`).
- `selftest.mjs` — drives the real entrypoint end to end against recorded
  outputs (`fixtures/`) and asserts the gate fails closed on a policy finding
  and retries only transport errors. CI runs it as the `audit-gate-selftest`
  job, so a regression turns that job red in the PR's own CI.
- `*.test.mjs` — unit tests for classification and retry orchestration, run by
  `bun run test:contracts`.

The `--fixture` / `--retry-delay-ms` flags on the entrypoint exist only for the
selftest; the CI gate step passes neither, so they cannot weaken a real run.
