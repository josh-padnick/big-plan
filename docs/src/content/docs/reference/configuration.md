---
title: Configuration and state
description: Every environment variable Big Plan reads and every directory it keeps state in.
---

Big Plan has no configuration file. Everything below is an environment variable read at
process start, or a directory Big Plan chooses on its own.

## Environment variables

### Read by the CLI and the local service

| Variable             | What it does                                                                                                                                                              | Default   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `BIG_PLAN_PORT`      | The port the review-link service listens on. Links saved at the old port stop resolving when you change it                                                                | `8790`    |
| `BIG_PLAN_PROXY`     | `0` restores the redirect to the session port instead of forwarding. A startup switch, read once when the service starts, so changing it needs `big-plan service restart` | forward   |
| `BIG_PLAN_STATE_DIR` | Pins all Big Plan state to exactly one directory. Test suites and sandboxed environments use it to keep state isolated                                                    | see below |

### Declared by a connecting coding agent

Export these before running `agent next`, `agent push`, or `agent note` to say who is
connected. All are optional and independent: declare only the ones you can answer, and the
reviewer is shown exactly those.

| Variable                     | What it declares                                                        | Limit       |
| ---------------------------- | ----------------------------------------------------------------------- | ----------- |
| `BIG_PLAN_AGENT_MODEL`       | Your API's own canonical model id, for example `grok-4.6`               | 80 chars    |
| `BIG_PLAN_AGENT_EFFORT`      | How hard the model was told to think, for example `high`                | 24 chars    |
| `BIG_PLAN_AGENT_CLIENT`      | Which tool is connected, for example `grok-cli 0.2.99`                  | 80 chars    |
| `BIG_PLAN_AGENT_SESSION_URL` | The agent's own conversation address; Big Plan decides whether it links | 2,048 chars |
| `BIG_PLAN_AGENT_SESSION`     | That conversation's opaque id, when it has no address                   | 120 chars   |

Terminal escape and control sequences are removed before the values are shown. Beyond that,
Big Plan does not guess missing facts or re-case an unrecognized id. A value that exceeds its
limit, is empty, or fails its own check is dropped on its own; the rest of the declaration
still stands. Where nothing is declared, the reviewer is shown no identity at all.

## Where state lives

| What                        | Where                                  | Notes                                                                                                                             |
| --------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Guidance acknowledgment     | `.big-plan/` under your home directory | Falls back to `big-plan/` under the system temporary directory when the home directory rejects writes                             |
| Review-link service records | `~/.big-plan/service/`                 | Owner-only: one small identity record per plan, the token that authorizes stopping, and an advisory record of the running process |
| Review state and feedback   | `.big-plan/` beside the plan           | Created for the reviewer only and ignored by version control                                                                      |

`BIG_PLAN_STATE_DIR` overrides the first two.

When no state location accepts writes at all, the guidance gate degrades rather than blocking:
`guidance` still prints in full and notes that the acknowledgment could not be saved, and
`validate`, `render`, and `review` proceed with a warning that it could not be verified.

## Related

- [Files Big Plan writes](/for-agents/#files-big-plan-writes) — the full layout beside your plan.
- [`big-plan service`](/reference/commands/service/) — the process that reads `BIG_PLAN_PORT`.
