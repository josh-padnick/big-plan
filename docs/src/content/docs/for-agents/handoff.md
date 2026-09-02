---
title: Handle a handoff or disconnect
description: What a coding agent does when the reviewer moves the primary seat or ends its session.
---

**Goal.** A loop that stops cleanly when the reviewer moves it aside, instead of churning
against a review it can no longer answer.

## The rule

One agent answers a review at a time, and which one is the reviewer's decision rather than a
race. The first connector to attach is the **primary**: it may claim work, report progress, and
publish. Every connector after it attaches as an **observer**, which may read the plan and may
do none of those three things — the reviewer's comments and the state of their requests are not
handed to an observer either.

An observer never picks up queued work, however long the primary has been quiet, and it never
becomes the primary by arriving.

## Branch on both shapes

The same situation reaches you as an error from some commands and as an ordinary result from
another. Branch on both, or your loop will poll forever.

| What you get           | From                                        | What it means                        | What to do                                                           |
| ---------------------- | ------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| `role: "observer"`     | `agent next`                                | Another agent is the primary         | Without `--wait`, exit. With `--wait`, stay attached and keep asking |
| `NOT_PRIMARY`          | `agent note`, `agent respond`               | You were displaced mid-turn          | Stop claiming. The message names the agent that holds the plan now   |
| `role: "disconnected"` | `agent next`                                | The reviewer took you off the review | Terminal, even with `--wait`. Stop the loop                          |
| `AGENT_DISCONNECTED`   | `agent push`, `agent note`, `agent respond` | Same fact, arriving as an error      | Terminal. Stop rather than retrying                                  |

A harness that watches only for `NOT_PRIMARY` reads the observer result as ordinary "no work"
and polls on, which is exactly the churn this design removes. The correct response to either is
to stop claiming, not to retry.

## What the results look like

```json
{
  "pending": false,
  "role": "observer",
  "plan": "/path/to/plan.mdx",
  "review": "http://127.0.0.1:8420/",
  "reason": "Another agent is the primary for this review, so this session cannot answer the reviewer yet"
}
```

```json
{
  "pending": false,
  "ended": true,
  "disconnected": true,
  "role": "disconnected",
  "plan": "/path/to/plan.mdx",
  "review": "http://127.0.0.1:8420/",
  "reason": "The reviewer disconnected this agent from the review, so this session no longer speaks for the plan"
}
```

The disconnect result states the fact twice on purpose — as the end (`ended` and
`disconnected`) and as the role you are no longer in — so a harness branches on whichever one
it already reads.

## Arriving as an observer is the request to be primary

Nothing extra has to be passed. The reviewer answers from **Agent Status**, where every
attached agent has a card offering **Make it primary**, **Leave it as observer**, or
**Disconnect this agent**.

With `--wait`, your loop stays attached and keeps asking until they answer, then continues as a
work item if they made you the primary.

## What happens to your work

**When you are displaced**, your open claim is freed. Your unpublished edits stay in your own
candidate copy and reach the plan only if the reviewer ticks the box that hands them over — and
even then they arrive to the new primary as `previous_agent_draft`, a path to read as
reference, never a candidate to publish.

**When you are disconnected**, the answer you were drafting is dropped, your private stage is
removed, and the reviewer's message goes back in the queue for whichever agent connects next.
The disconnect is a message rather than a kill: Big Plan never reaches into your process. You
are told at your next command and end your own session there.

Either way, the reviewer's comments and questions stay exactly where they are.

## Coming back after publishing

A published turn keeps its own seat for as long as your return trip takes. Run the `next`
command `agent respond` returned, unchanged — it reclaims the same registration at once. While
that return trip is open, Big Plan cannot tell a second agent from the incumbent coming back,
so a question about a waiting arrival is held rather than put to the reviewer.

## One recovery path

An observer succeeds to the seat by itself in exactly one case: the primary fell silent and the
seat has stayed empty for longer than a turn's own quiet. That is the recovery path for an
agent that died mid-review, and it is deliberately slow. Every other way a seat empties is
either momentary or the reviewer's own decision.

## Next

[Handle an approval](/for-agents/approval/) — what to do when the review approves the plan.
