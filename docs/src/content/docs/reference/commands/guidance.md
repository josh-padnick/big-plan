---
title: big-plan guidance
description: Print the plan-writing principles and record the acknowledgment that unlocks the gated commands.
---

## Synopsis

```text
big-plan guidance [component]
```

## Arguments

| Argument    | Required | Behaviour                                                                            |
| ----------- | -------- | ------------------------------------------------------------------------------------ |
| `component` | No       | Print one component's judgment-level usage guidance instead of the shared principles |

## What it does

`guidance` prints the authoring principles for writing a plan a human loves to review.
It deliberately prescribes principles rather than a template, so each plan keeps the structure its content needs.
Running it also records a guidance acknowledgment for the current working directory.

With a component name, `big-plan guidance <Component>` prints that component's judgment-level usage guidance instead: when to reach for it and what belongs in it.
`big-plan guidance Slide` returns every registered slide type and its matching, authoring, component-pairing, and cardinality guidance in one call for the whole plan.
The component form records no acknowledgment, and an unknown name fails with the list of components that have guidance.

For a persistent or project-local install, guidance also ends with one passive update line when a recent registry check found a newer published version.
The line points to the installation guide and asks the user to update with the package manager that owns that installation.
The check refreshes silently after command output and is cached, so a slow or unavailable registry never delays or fails guidance; a failed check produces no line.
Ephemeral `npx` runs skip the check and notice because `npx -y big-plan@latest` already selects the current release.

`validate`, `render`, and `review` require a current acknowledgment and fail with a structured `GUIDANCE_REQUIRED` error until `guidance` has been run.
An acknowledgment is current when it was recorded for the same working directory within the last 24 hours against the guidance content the installed CLI ships.
Updating Big Plan to a release with changed guidance therefore re-locks all three commands until `guidance` is read again.
`compile`, `skill`, and `agent` are not gated, so machine tooling, skill install, and an already-live agent loop can run without the authoring workflow.

Acknowledgment state lives outside the project: in `.big-plan/` under the user's home directory, falling back to a `big-plan/` directory under the system temporary directory when the home directory rejects writes, as workspace-scoped sandboxes commonly do.
Setting the `BIG_PLAN_STATE_DIR` environment variable pins state to exactly one directory, which test suites and sandboxed environments use to keep state isolated.

When no state location accepts writes at all, the gate degrades instead of blocking: `guidance` still prints the full guidance and notes that the acknowledgment could not be saved, and `validate`, `render`, and `review` proceed while their results carry a warning that the acknowledgment could not be verified.
Filesystem restrictions therefore never lock an agent out of the plan workflow.

## Result

`guidance` returns the guidance Markdown itself rather than a structured result.

## Errors

| Code               | Raised when                                                                        | Exit |
| ------------------ | ---------------------------------------------------------------------------------- | ---- |
| `VALIDATION_ERROR` | The component name is unknown; the message lists the components that have guidance | 2    |

## Troubleshooting

- **A gated command still says `GUIDANCE_REQUIRED` after you ran this.** The acknowledgment is
  recorded for one working directory. Run it from the directory you will run `validate`,
  `render`, or `review` in.
- **It re-locked after an upgrade.** The acknowledgment is recorded against the guidance content
  the installed CLI ships, so a release with changed guidance expires it. Read it again.
- **The result warns the acknowledgment could not be saved.** No state location accepted
  writes. The gate degrades rather than blocking: the gated commands still run and carry a
  warning. Set `BIG_PLAN_STATE_DIR` to a writable directory to fix it properly.
- **You want one component's rules.** `big-plan guidance DecisionAnalysis`. That form records
  no acknowledgment.

## Related

- [Where each rule lives](/authoring/where-rules-live/) — which surface owns which rule.
- [Configuration and state](/reference/configuration/) — where the acknowledgment is stored.
