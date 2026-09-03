---
title: big-plan review
description: Serve one plan locally for commenting, decisions, agent exchange, and approval.
---

## Synopsis

```text
big-plan review <input.mdx> [--diff-preview] [--idle-timeout <minutes>] [--takeover]
```

## Arguments

| Argument    | Required | Behaviour                                                   |
| ----------- | -------- | ----------------------------------------------------------- |
| `input.mdx` | Yes      | The plan to serve. A second positional argument is rejected |

## Options

| Option                     | Behaviour                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--idle-timeout <minutes>` | Close an abandoned session after that much inactivity. Defaults to no timeout; `--idle-timeout 0` says the same thing explicitly, and a nonzero value must be at least 1 minute |
| `--takeover`               | Replace a live runtime deliberately. The replaced runtime keeps listening but loses write custody, so its page and its agent become read-only until each reloads                |
| `--diff-preview`           | Temporary development-only flag that seeds a synthetic gallery answer and marks the browser with a visible preview banner                                                       |

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

| Code                | Raised when                                                                                                                                        | Exit |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `GUIDANCE_REQUIRED` | Guidance has not been read for this working directory in the last 24 hours                                                                         | 2    |
| `VALIDATION_ERROR`  | The input argument is missing, a second positional argument is present, an option is unknown, the MDX is invalid, or the plan fails authoring lint | 2    |
| `INVALID_INPUT`     | `--idle-timeout` is empty, non-numeric, negative, a nonzero sub-minute value, or overflowing                                                       | 2    |
| `INPUT_NOT_FOUND`   | The plan cannot be read                                                                                                                            | 1    |

Lint runs before the port opens, so a plan that fails lint never reaches a reviewer.

## Troubleshooting

Reading a plan almost never breaks. What fails is writing to it - sending a comment, saving a
decision answer, recording an acceptance - and the review always says which of those it is
refusing before it tries.

| What you see                                          | What it means                                                                                                                | What to do                                                                                                                    |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **This review session has stopped accepting changes** | One change never finished; after 30 seconds the runtime refuses it and answers later writes rather than leaving them waiting | Keep the tab open, stop the runtime with `Ctrl+C`, and start it again on the same plan                                        |
| The page reports it has lost contact with the runtime | A request timed out; the page cannot tell an idle expiry from a stopped runtime                                              | Use **Refresh** when it is offered; if you have unsaved input it stays disabled and the page asks you to keep the tab open    |
| **This tab's review session is out of date**          | The runtime is answering but no longer recognises this tab, because it was restarted or its store re-created under the page  | Use **Reload**; the agent card's disconnect control and every send control stay inert with this reason until the page reloads |
| **Open latest review** appears                        | A newer review session for this plan was recorded before contact was lost                                                    | Follow it; that session holds write custody now                                                                               |
| The stable address says the review is restarting      | A runtime stopped without recording an ending                                                                                | The address is held for the replacement; the page carries the command that starts the review again                            |
| A deliberate stop page                                | Someone stopped the runtime with `Ctrl+C` or it hit its idle timeout                                                         | Start the review again on the same plan                                                                                       |
| `custody: held` from `big-plan review`                | A live runtime already serves this plan                                                                                      | Open the address the command printed rather than starting a second runtime                                                    |
| An action is refused before it sends                  | The runtime is unreachable, the tab is out of date, writes have stalled, or a newer session replaced this one                | Nothing you typed is discarded; the refusal names the condition the page actually observed                                    |
| **Agent may be stalled**                              | The agent has reported nothing for 75 seconds                                                                                | This describes the silence, not the connection; the work is still picked up and the answer is still accepted when it arrives  |
| **Blocked - no agent connected**                      | No agent is attached to answer                                                                                               | The message sends itself when one reconnects                                                                                  |

The page cannot tell an idle expiry from a runtime someone stopped, so it reports what it
observed rather than guessing, and it never tells you to start a new runtime - this command is
the only thing that decides whether starting or taking over is allowed.

Before stopping an unresponsive runtime on macOS or Linux, ask it for a diagnostic dump:

```sh
kill -USR2 <review-process-pid>
```

The signal does not stop the review. It prints the session, plan path, in-flight and stalled
writes, and current growth counts to the review command's standard error output.

- **`custody: held`.** A live runtime already serves this plan. Open the address the command
  printed; starting a second runtime is not what you want.
- **The default port is taken.** Big Plan never moves to a different port on its own. The
  command says so, names the holder where the platform can report one, and keeps working with
  the session's direct address. `BIG_PLAN_PORT` chooses a different port, remembering that
  links saved at the old one stop resolving.
- **The page stopped accepting changes.** See
  [When a review goes wrong](#troubleshooting).
- **A saved link stopped opening.** The small local service answers those;
  [`big-plan service`](/reference/commands/service/) inspects and restarts it.

## Related

- [Start a review](/intro/first-review/) — the task page for this command.
- [When a review goes wrong](#troubleshooting) — every review failure.
