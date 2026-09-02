---
title: When a review goes wrong
description: Every way a live review fails, with the symptom you see and the fix.
---

**Goal.** A review that is answering again, or a clear reading of why it is not.

Reading a plan almost never breaks. What fails is writing to it — sending a comment, saving a
decision answer, recording an acceptance — and the review always tells you which of those it
is refusing before it tries.

## Find your symptom

| What you see                                          | What it means                                                                                                                | What to do                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **This review session has stopped accepting changes** | One change never finished; after 30 seconds the runtime refuses it and answers later writes rather than leaving them waiting | Keep the tab open, stop the runtime with `Ctrl+C`, and start it again on the same plan                                       |
| The page reports it has lost contact with the runtime | A request timed out; the page cannot tell an idle expiry from a stopped runtime                                              | Use **Refresh** when it is offered; if you have unsaved input it stays disabled and the page asks you to keep the tab open   |
| **Open latest review** appears                        | A newer review session for this plan was recorded before contact was lost                                                    | Follow it; that session holds write custody now                                                                              |
| The stable address says the review is restarting      | A runtime stopped without recording an ending                                                                                | The address is held for the replacement; the page carries the command that starts the review again                           |
| A deliberate stop page                                | Someone stopped the runtime with `Ctrl+C` or it hit its idle timeout                                                         | Start the review again on the same plan                                                                                      |
| `custody: held` from `big-plan review`                | A live runtime already serves this plan                                                                                      | Open the address the command printed rather than starting a second runtime                                                   |
| An action is refused before it sends                  | The runtime is unreachable, has stopped accepting changes, or a newer session replaced this one                              | Nothing you typed is discarded; the refusal names the condition the page actually observed                                   |
| **Agent may be stalled**                              | The agent has reported nothing for 75 seconds                                                                                | This describes the silence, not the connection; the work is still picked up and the answer is still accepted when it arrives |
| **Blocked - no agent connected**                      | No agent is attached to answer                                                                                               | The message sends itself when one reconnects                                                                                 |

## What the page can and cannot tell you

When an already-open page loses contact with its review runtime, it reports that loss rather than claiming the server stopped, because a request that merely timed out can happen while the runtime is still running.
If the deadline the page last knew has also passed, it reports that observation too.
When the page has no unsaved browser-only input, Refresh is offered in either case so you can check whether the review is still running.
If it does have unsaved input, Refresh stays disabled and the page asks you to keep the tab open instead.
It does not say why contact was lost, because a page that has lost contact cannot tell an idle expiry from a runtime someone stopped, or from one that is still serving another tab.
For the same reason it never tells you to start a new review runtime; the command is the only place that decides whether starting or taking over a runtime is allowed, and it answers that question for you.
When a newer review session for that plan was recorded before contact was lost, the page also links to it as **Open latest review**.

## Diagnose an unresponsive session

Keep the terminal running the review open when the page stops answering.
The runtime gives up on waiting for a write that has run for 30 seconds, reports it once with its route and age, and lets the next write run.
The unfinished work is not cancelled and may still hold the review store's lock, so later writes are answered promptly with the same refusal rather than served.
It also reports current progress-history and agent-exchange counts when retained state crosses each 1,000-entry milestone.
Request failures that reach the runtime's generic error boundary leave their safe error type and stack in that terminal while keeping the reviewer-facing message and sensitive details out of the log.

Before stopping an unresponsive runtime on macOS or Linux, ask it for an immediate diagnostic dump:

```sh
kill -USR2 <review-process-pid>
```

The signal does not stop the review.
It prints the session, plan path, in-flight and stalled writes, and current growth counts to the review command's standard error output.

## When the runtime stops accepting changes

A review session can stay online after one change never finishes: reading the plan keeps working, but the runtime stops accepting changes.
After 30 seconds, the runtime refuses the unfinished request and answers later direct write requests instead of leaving them waiting indefinitely.
The page then shows a **This review session has stopped accepting changes** alert, disables sending, and stops automatic draft-save requests instead of submitting changes the runtime has already said it will refuse.
The runtime keeps renewing its heartbeat, so the coding agent still sees the session as live, but it cannot save changes through that runtime.
Already persisted review data remains available, and a newly staged comment stays in the page and its local recovery snapshot, so keep the tab open, stop the runtime, and start it again on the same plan.

Every action that changes the review asks the same question before it sends: submitting comments, replying in a thread, asking a plan-wide question, deleting a sent comment, reverting the agent's changes, cancelling a queued request, changing auto-accept mode, and attaching an image.
When the answer is no, the action is refused up front and says why, what became of what you typed, and what clears the block, rather than appearing to start and failing seconds later.
Reading is never affected, and nothing you typed is discarded: text stays in its box, an unattached image leaves the message unchanged, and a request you could not cancel is still reported as being with the agent.
The same refusal covers a runtime the page has lost contact with and a session a newer review runtime has replaced, so the reason you are given always matches the condition the page actually observed.

## Errors from the command itself

`review` fails before it opens a port rather than serving a plan it cannot stand behind.

| Code                | Raised when                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `GUIDANCE_REQUIRED` | Guidance has not been read for this working directory in the last 24 hours                                                   |
| `VALIDATION_ERROR`  | The input argument is missing, a second positional argument is present, the MDX is invalid, or the plan fails authoring lint |
| `INVALID_INPUT`     | `--idle-timeout` is empty, non-numeric, negative, a nonzero value under one minute, or overflowing                           |
| `INPUT_NOT_FOUND`   | The plan file cannot be read; the message carries the resolved absolute path                                                 |

Every code, and which commands raise it, is in [Error codes](/reference/error-codes/).

## Next

[big-plan service](/reference/commands/service/) — inspect or restart the small local process
that answers saved review links.
