---
title: big-plan agent
description: "The coding-agent side of a live review: claim work, report progress, and publish an answer."
---

## Synopsis

```text
big-plan agent <input.mdx>
big-plan agent next <input.mdx> [--wait] [--agent <token>] [--connection <token>]
big-plan agent push <input.mdx> (--prompt "<text>" | --about "<text>") [--thread <id>] [--agent <token>] [--connection <token>]
big-plan agent note <input.mdx> "<progress>" --agent <token> [--connection <token>]
big-plan agent respond <input.mdx> <response.json> --agent <token> [--connection <token>]
```

## What each action does

`agent <input.mdx>` reads the matching live session and returns the owner-only
prompt plus pasteable Codex and Claude launch commands. Big Plan does not call
a model provider itself. The launched coding-agent session uses:

- `agent next <input.mdx> --wait` to receive the oldest pending feedback,
  thread reply, or plan-wide chat question, its prior conversation, a validated
  response template, the private candidate to edit, and the exact publish command;
- `agent push <input.mdx> --prompt "<text>"` to relay the reviewer's own words as an agent-initiated thread, or `--about "<text>"` to open it in the agent's words;
- `agent note <input.mdx> "<progress>"` to keep the reviewer
  informed as each meaningful work step begins; and
- `agent respond <input.mdx> <response.json>` to publish one
  complete answer, and the candidate it was written against, after that
  candidate has rendered and passed lint.

A claim records the connection that took it, so the agent that is working can be named without ever naming one that is only waiting.

`agent push` opens and claims a private candidate immediately rather than placing work in the reviewer-message queue.
Exactly one of `--prompt` or `--about` is required because the stored origin determines whose words the review later presents.
Pass the returned thread id back with `--thread <id>` to continue a pushed thread; omitting it opens a new thread.
A resolved or unknown thread is refused, and any live claim or other non-terminal push on the plan must be answered or canceled first.
Queued but unclaimed reviewer messages do not block a push, but the returned `rules` list names their count so the agent can answer them next.
The result mirrors `agent next`: it returns the claimed `work`, private `candidate_plan`, `response_file`, claim and connection tokens, ready-to-run `note_command` and `respond_command`, and whether the returned thread was opened or continued.
The unchanged reviewer cancel action drops the push's private stage and releases the plan.

`agent next` mints the `--agent` token when it hands out a request, and returns
it as `agent_token` together with ready-to-run `note_command`,
`respond_command`, and `next_command` strings.
It also mints the `--connection` token at the agent's first command and returns
it as `connection_token`, carried by every command string it returns.
The two say different things: the agent token names one claim and ends with it,
while the connection token names the agent session running the loop and lasts as
long as that session does.
Running the returned commands unchanged hands both back, which is what lets the
reviewer's **Agent Status** name one connected agent across a whole conversation
instead of a new one at every command - and what lets a decision the reviewer
takes between two of the agent's commands still reach it.
An agent that brings no connection token is a new connection and is given a new
one, so a second agent never inherits a decision taken about the first.
It also returns `candidate_plan`: this claim's own copy of the plan, and the
only repository file the agent edits.
The agent writes its response JSON to the returned `response_file`, then runs
the returned `respond_command` to validate and publish both files.
The plan path itself stays read-only identity, so relative asset paths and
repository context still resolve against it, and Big Plan writes it only when a
response publishes.
Resuming with `--agent <token>` returns the same candidate, with the edits the
previous process left in it.
The returned `note_command` includes the progress text `"Working on the request"`, so running it unchanged records that update and renews the claim.
For later meaningful steps, use `agent note <input.mdx> "<progress>" --agent <token>` with a short, specific progress line.
If the agent process restarts while that request remains open, pass the returned token back with `agent next <input.mdx> --agent <token>` to resume the same pickup.
Run the returned `note_command` and `respond_command` strings unchanged.
The token is what proves this agent process holds the request, so a second
agent working the same review cannot narrate over or answer another agent's
work.
Only one request on a plan may hold a live claim, so a second agent waits rather than editing the plan in parallel.
Without `--wait`, `agent next` reports that no work is available while another claim is live.
With `--wait`, it continues once the holder's request is answered or canceled.
A waiting `agent next` also ends when the process that started it does: it records that process at startup, rechecks it before every wait and once more before claiming, and exits rather than claiming work whose output nothing would read.
A lapsed lease no longer risks the plan.
Every claim carries a generation that a reviewer's hand-off raises, the displaced agent keeps writing only to its own candidate, and `agent respond` refuses a generation that no longer holds the claim.
A hand-off therefore starts from the last published revision, and the reviewer is told the previous agent's unpublished edits stayed in its own stage.

A claim also ends when the reviewer takes the message back: once an agent has reported nothing for far longer than a turn takes and no agent is connected, that claim counts as abandoned and the message becomes editable and deletable again.
Taking a message back discards the stage its claim was drafting, and a returning agent's `agent respond` is refused rather than published, so pick up current work with `agent next`.

The reviewer can also take an agent off a review from **Agent Status**, and every `agent` command answers that at its next run.
The disconnect names exactly one agent, by the connection token of the agent holding the plan's live claim, or by the connected agent's own connection token when no claim is live.
It names a connection rather than a pickup because disconnecting releases that pickup immediately, so it reaches that agent whether it is mid-answer or between commands, and it reaches nobody else - including a second agent waiting beside it.
`agent next` reports it as an ordinary end - `ended`, `disconnected`, and `role: "disconnected"` with the reason, and a zero exit - after marking the session ended so the reviewer's connection log records a reported end rather than a silence.
`agent push`, `agent note`, and `agent respond` refuse with the `AGENT_DISCONNECTED` code and a nonzero exit, so a harness stops rather than retrying a command that can never succeed again.
The answer the disconnected session was drafting is dropped, its private stage is removed, and the reviewer's message goes back in the queue for whichever agent connects next.
The agent also leaves the roster of attached agents, so the seat it held is empty and the next connector takes it instead of attaching as an observer of an agent that has gone.

`agent respond` publishes under one plan-mutation lock: it re-proves the claim, requires the plan to still carry the revision the candidate started from, and swaps the candidate in with one atomic rename.
A response that finds the plan changed underneath it is refused with the `SOURCE_MOVED` code rather than applied, so the agent takes the work again from the current plan.
If the process dies mid-publish, the next `agent` command and the next `big-plan review` settle the interrupted commit before serving anything: the answer completes if the swap won, the request stays open if it did not, and a plan matching neither revision stops agent edits with a conflict naming both digests instead of overwriting the file.

Export any of these environment variables before running `agent next`, `agent
push`, or `agent note` to report who is connected. They carry the four facts **Agent Status**
shows, with a session declared either as an address or as an id:

| Variable                     | What it declares                                                         | Limit       |
| ---------------------------- | ------------------------------------------------------------------------ | ----------- |
| `BIG_PLAN_AGENT_MODEL`       | Your API's own canonical model id, for example `grok-4.6`.               | 80 chars    |
| `BIG_PLAN_AGENT_EFFORT`      | How hard the model was told to think, for example `high`.                | 24 chars    |
| `BIG_PLAN_AGENT_CLIENT`      | Which tool is connected, for example `grok-cli 0.2.99`.                  | 80 chars    |
| `BIG_PLAN_AGENT_SESSION_URL` | The agent's own conversation address; Big Plan decides whether it links. | 2,048 chars |
| `BIG_PLAN_AGENT_SESSION`     | That conversation's opaque id, when it has no address.                   | 120 chars   |

All are optional and independent: declare only the ones you can answer, and the
reviewer is shown exactly those.

**Agent Status** shows a copy control beside every declared session whose bare
id Big Plan can resolve. It copies `BIG_PLAN_AGENT_SESSION` when present,
otherwise the last non-empty path segment of `BIG_PLAN_AGENT_SESSION_URL`. A
recognized session URL also keeps its separate **Open the agent's chat** link.

Terminal escape and control sequences are removed before the values are shown,
because they are terminal formatting rather than part of the declaration.
Beyond that cleanup, Big Plan does not guess missing facts or re-case an
unrecognized id: its declared text is shown unchanged.
Where nothing is declared the reviewer is shown no identity at all rather than a
note about its absence.
A value that exceeds its limit, is empty, or fails its own check is dropped on
its own; the rest of the declaration still stands.
`agent next` and `agent push` store the declaration with the durable per-pickup claim, and `agent note` preserves or refreshes that claim identity.
The reviewer's browser reads the declaration from the pickup it is describing, for as long as that pickup still explains the plan's quiet, so a waiting agent's heartbeat cannot relabel another agent's request.

A `changed` outcome is accepted only when the result snapshot differs and every
named target belongs to the computed snapshot diff. Other outcomes are
`answered`, `warning`, `needs-input`, and `declined`; a warning makes no edit,
must carry a short scannable `summary` of the boundary it would cross,
and waits for explicit reviewer confirmation. **What changed** uses retained
premise, claim-time baseline, and result snapshots rather than DOM mutation.
The temporary development-only `review --diff-preview` flag seeds a synthetic
gallery answer through that same pipeline and marks the browser with a visible
preview banner.

## One review, one primary agent

One agent answers a review at a time, and which one is the reviewer's decision rather than a race.
The first connector to attach is the **primary**: it may claim work, report progress, and publish.
Every connector after it attaches as an **observer**, which may read the plan and may do none of those three things; the reviewer's comments and the state of their requests are not handed to an observer either.
An observer never picks up queued work, however long the primary has been quiet, and it never becomes the primary by arriving.

Arriving as an observer is itself the request to become the primary, so nothing extra has to be passed for the reviewer to be asked.
`agent next` returns this instead of a work item:

```json
{
  "pending": false,
  "role": "observer",
  "plan": "/path/to/plan.mdx",
  "review": "http://127.0.0.1:8420/",
  "reason": "Another agent is the primary for this review, so this session cannot answer the reviewer yet"
}
```

Without `--wait` that result is final and the process should exit.
With `--wait` the loop stays attached and keeps asking until the reviewer answers, then continues as a work item if they made it the primary.

The reviewer answers from **Agent Status** in the review, where every attached agent has a card: **Make it primary**, **Leave it as observer**, or **Disconnect this agent**.
Making an observer the primary displaces the incumbent immediately: its open claim is freed, and the reviewer may hand its unpublished draft to the new primary as `previous_agent_draft` - a path to read as reference, never a candidate to publish.

A displaced agent finds out at its next command rather than after paying for a whole turn, and there are two shapes to branch on.
`agent note` and `agent respond` refuse with the error code `NOT_PRIMARY`, explaining that this agent is an observer and naming the primary agent.
`agent next` is not an error: a displaced loop is an observer again, so it returns the `role: "observer"` result above.
Branch on both.
A harness that watches only for `NOT_PRIMARY` reads the observer result as ordinary "no work" and polls on, which is exactly the churn this design removes; the correct response to either is to stop claiming, not to retry.

**Disconnect this agent** ends the loop outright rather than moving its role.
The reviewer's answer is recorded, so a loop already waiting on `--wait` is told at its very next refresh instead of quietly registering again, and `agent next` returns a final result:

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

That is the same result **Disconnect agent** on the agent status card returns, because it is the same fact: the reviewer took this agent off the review.
It states that fact twice on purpose - as the end (`ended` and `disconnected`) and as the role it is no longer in (`role`) - so a harness branches on whichever one it already reads, rather than on which control the reviewer pressed.
That result is terminal even with `--wait`: stop the loop.
`agent note` and `agent respond` from the same session refuse with `AGENT_DISCONNECTED` and say the reviewer disconnected the agent, for as long as the turn they belong to could still be running.
The claim it was part way through is freed as well, so the turn it had in flight can no longer reach the plan, and no other agent's claim is touched.
Disconnecting the agent that answers the review leaves the review with no primary until the reviewer fills the seat, and they have two ways to do it.
No agent already attached succeeds into a seat the reviewer emptied, so an observer waits there until they pick it from **Agent Status**.
A connector started afterwards is a different matter: it arrives to an empty seat and becomes the primary under the ordinary arrival rule, without being asked, because running the connect prompt is the reviewer saying who answers.

A published turn keeps its own seat for as long as the answering agent's return trip takes.
`agent respond` therefore returns `next`: an `agent next ... --wait --agent <token>` command carrying the token just answered under.
Run it as given.
It reclaims the same registration at once, which is what keeps one agent one agent to the reviewer across the several short-lived processes a turn takes.
A bare `agent next` after publishing mints a new identity instead, so it attaches as an observer of the turn it just finished and waits for the seat rather than picking up straight away.
It does not put a question to the reviewer while it waits: until the return trip is over, Big Plan cannot tell a second agent from the incumbent coming back, so the question is held.
The question is raised as soon as the incumbent's closed claim has no later signal, or once the incumbent's silence crosses the stall horizon, establishing that the waiting arrival is a second agent.

An observer succeeds to the seat by itself in one case only: the primary fell silent, and the seat has stayed empty for longer than a turn's own quiet.
That is the recovery path for an agent that died mid review, and it is deliberately slow.
Every other way a seat empties - a turn ending, a poll returning, a reviewer disconnecting the primary - is either momentary or the reviewer's own decision, and neither is a vacancy to be filled.

## Errors

| Code                 | Raised when                                                                                           | Exit    |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------- |
| `INVALID_INPUT`      | An unknown action or invalid action arguments; the message carries the complete multi-line usage text | 2       |
| `NOT_PRIMARY`        | On `note` and `respond`, when the reviewer has made another attached agent the primary                | nonzero |
| `AGENT_DISCONNECTED` | On `push`, `note`, and `respond`, when the reviewer has disconnected this agent                       | nonzero |
| `SOURCE_MOVED`       | On `respond`, when the plan no longer carries the revision the candidate started from                 | nonzero |

`agent next` reports the observer and disconnected situations as ordinary results rather than
errors — `role: "observer"` and `role: "disconnected"` — so a harness must branch on those too.

`agent` is not gated by the guidance acknowledgment, so an already-live loop keeps running.

## Troubleshooting

- **`agent next` returns no work while another claim is live.** Only one request on a plan may
  hold a live claim. Pass `--wait` to continue once the holder's request is answered or
  canceled.
- **You got `role: "observer"`.** Another agent is the primary. Without `--wait` that result is
  final and the process should exit; with `--wait` the loop keeps asking until the reviewer
  answers.
- **`NOT_PRIMARY` or `role: "observer"`.** Both mean the same thing arriving in two shapes.
  Branch on both; a harness that watches only for `NOT_PRIMARY` reads the observer result as
  ordinary "no work" and polls on.
- **`AGENT_DISCONNECTED`.** Terminal. Stop the loop rather than retrying.
- **`SOURCE_MOVED`.** The plan changed underneath your candidate. Take the work again from the
  current plan with `agent next`.
- **The reviewer sees a new agent at every command.** You are not passing the returned tokens
  back. Run the returned `note_command`, `respond_command`, and `next_command` strings unchanged.

## Related

- [Answer reviewer feedback](/for-agents/) — the loop, as numbered steps.
- [Handle a handoff or disconnect](/for-agents/) — what to do when the seat moves.
