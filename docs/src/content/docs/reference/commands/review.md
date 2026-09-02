---
title: big-plan review
description: Serve one plan locally for commenting, decisions, agent exchange, and approval.
---

## Synopsis

```text
big-plan review <input.mdx> [--diff-preview] [--idle-timeout <minutes>] [--takeover]
```

## Arguments

| Argument | Required | Behaviour |
| --- | --- | --- |
| `input.mdx` | Yes | The plan to serve. A second positional argument is rejected |

## Options

| Option | Behaviour |
| --- | --- |
| `--idle-timeout <minutes>` | Close an abandoned session after that much inactivity. Defaults to no timeout; `--idle-timeout 0` says the same thing explicitly, and a nonzero value must be at least 1 minute |
| `--takeover` | Replace a live runtime deliberately. The replaced runtime keeps listening but loses write custody, so its page and its agent become read-only until each reloads |
| `--diff-preview` | Temporary development-only flag that seeds a synthetic gallery answer and marks the browser with a visible preview banner |

## Result

When `review` takes custody of the plan, it returns the stable loopback address,
resolved plan path, session id, and feedback directory, then keeps running until
`Ctrl+C` or an opt-in idle timeout. It owns the local session token,
heartbeat, durable review state, and source snapshots.

`review` is the plan's address on the review-link service. It is the same for
every run of the same plan file and keeps answering through runtime restarts.
`direct` is the ephemeral session address and is reported as a debugging line.
When the service cannot run, `review` falls back to that direct address,
`direct` is omitted, and `help` says why.

It always reports `custody`, because only one runtime may hold a plan at a time,
and that value says whether this command took it:

- `activated`: this runtime took a free plan and is now serving it.
- `held`: a live runtime already serves this plan, so no second runtime started. The returned address, plan, and session id are that live runtime's, and no `feedback` directory is reported. The command exits instead of listening.
- `seized`: `--takeover` replaced a live runtime, which is named in `help`.

Liveness is the session heartbeat the coding agent already relies on, plus one
freshness window of grace for a runtime that has not yet written its first
heartbeat, so two simultaneous starts cannot both take the same plan.
A stopped, expired, or crashed session leaves the plan free, and the next
`review` takes custody normally.
`--takeover` leaves the replaced runtime listening without write custody, which
makes its open page and its connected agent read-only until each reloads.

## Errors

| Code | Raised when | Exit |
| --- | --- | --- |
| `GUIDANCE_REQUIRED` | Guidance has not been read for this working directory in the last 24 hours | 2 |
| `VALIDATION_ERROR` | The input argument is missing, a second positional argument is present, an option is unknown, the MDX is invalid, or the plan fails authoring lint | 2 |
| `INVALID_INPUT` | `--idle-timeout` is empty, non-numeric, negative, a nonzero sub-minute value, or overflowing | 2 |
| `INPUT_NOT_FOUND` | The plan cannot be read | 1 |

Lint runs before the port opens, so a plan that fails lint never reaches a reviewer.

## Troubleshooting

- **`custody: held`.** A live runtime already serves this plan. Open the address the command
  printed; starting a second runtime is not what you want.
- **The default port is taken.** Big Plan never moves to a different port on its own. The
  command says so, names the holder where the platform can report one, and keeps working with
  the session's direct address. `BIG_PLAN_PORT` chooses a different port, remembering that
  links saved at the old one stop resolving.
- **The page stopped accepting changes.** See
  [When a review goes wrong](/review/troubleshooting/).
- **A saved link stopped opening.** The small local service answers those;
  [`big-plan service`](/reference/commands/service/) inspects and restarts it.

## Related

- [Start a review](/review/start-a-review/) — the task page for this command.
- [When a review goes wrong](/review/troubleshooting/) — every review failure.
