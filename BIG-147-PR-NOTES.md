# BIG-147 pull-request notes

These correct the decisions recorded while the fix was in progress, so the pull-request description states what shipped rather than machinery that was later removed.
They replace decisions 5 and 10 of the original task notes, and the matrix rows those decisions touched.

## Decision 5 (replaces the `agentHoldsOpenRequest` account)

One signal was answering two questions, so the fix splits the questions rather than sharing an answer between them.

A connection surface reports observed presence and nothing else.
It never asserts a connection from held work, because a claim outlives the process that took it: an agent killed mid-turn leaves a non-terminal claim behind, and a review runtime restarted afterwards would otherwise report a connection on the very first check of a session no agent has ever attached to.
It never denies one either.
A stale heartbeat is an absence of signal, not an observed disconnection, so the health card, the connection log's summary, its rows, durations and counters, and the reason the runtime stores on the edge all name the missing signal and the quiet period it opens.

Picked-up work is judged by its own narration on the activity surfaces: a renewed lease reads as working, a quiet one as stalled naming how long it has been quiet, and only an unclaimed plan lets presence decide idle against disconnected.

Held work is allowed to withhold advice premised on nobody being there.
`agentHoldsClaimedWork` in `src/review/shared/agent-status.ts` is the one definition of it, deliberately blind to the lease because the quiet turn it answers for has by definition already let its lease lapse.
It suppresses the Agent tab's reconnect disclosure and keeps a message queued behind a live turn from reading **Blocked - no agent connected**.
It is an activity and queue input only, and never reaches `agentConnected`, `projectAgentConnectionState`, or any connection card.

The earlier plan - a runtime-side `agentHoldsOpenRequest` consulted before writing a connection edge, and a matching browser-side override - was withdrawn.
It made the runtime assert a connection it had not observed, which is the mirror of the bug being fixed, and it cost an exchange directory read on every heartbeat tick for the length of every turn.
Both helpers are gone; the runtime records presence alone.

## Decision 10 (test layering)

Test layering still follows `_internal/TESTING.md`: the lowest rung that proves the behaviour.

Protocol and lease semantics are unit and contract tests in `src/review/shared/agent-status.test.ts`, `src/review/shared/thread-projection.test.ts` and `src/review/request-mailbox.test.ts`.
The killed-agent regression - an abandoned non-terminal claim must not make a fresh review session report a connection - sits in `agent-status.test.ts`, because `projectAgentConnectionState` is where that assertion would have been made.
The answer-time ownership fence is proven against a takeover written while the answer already waits behind the request lock, and was verified to fail when the ownership check is hoisted out of `withRequestLock`.

Two browser journeys exist because both need the real agent CLI process boundary, in `test/commenting-agent-cli.spec.ts`: the quiet turn reading stalled rather than disconnected and still having its answer accepted, and the reconnect disclosure staying absent while work is held, including the takeover it would otherwise invite.

The earlier note that no server-timer test was needed "because its correctness reduces to `agentHoldsOpenRequest`" no longer applies; that helper and its contract test were removed, and the runtime's connection check now has no branch beyond presence.

## Decision 12 (the recovery horizon)

Held work explains an agent's silence, but nothing ever reaps a claim: `claimedBy` is never cleared on an unanswered, uncanceled request, and the exchange is scoped by plan rather than by review session, so an abandoned claim survives restarting `big-plan review`.
Unbounded, that explanation would suppress the reviewer's only route back to a working agent forever - the recovery disclosure is the sole place the recovery prompt and connector command are rendered, and every "connect an agent" link in the review UI routes there.
A reviewer whose agent died would be shown a queue and no way to learn they must start one.

`AGENT_RECOVERY_HORIZON_MS` bounds it at 24 x `AGENT_STALL_MS` (30 minutes).
`AGENT_STALL_MS` is 75 seconds - one minute of expected narration plus 15 seconds of jitter - so the horizon sits an order of magnitude beyond any plausible single turn: an agent quiet that long has finished, died, or drifted so far outside its expected cadence that the explanation costs more than it is worth.
The quiet is measured from the claim's own last signal (`claimSignalAtMs`), never from the lease, because a quiet turn's lease is lapsed by definition and a lease test would collapse the bound to a no-op.

The asymmetry decides the direction. Withholding recovery leaves a reviewer stuck with no route forward and no way to discover one; offering it costs a takeover the reviewer is explicitly told about, and `commitRequestTerminal`'s ownership fence means a displaced agent's answer is refused rather than silently interleaved.
A stuck reviewer is the worse outcome, so past the horizon the explanation ends everywhere at once, from one definition: the stalled card falls through to the ordinary presence answer (because "this updates by itself once the agent resumes" is a promise nothing will keep once a claim is that old), a newly sent message reads blocked rather than queued, and the recovery disclosure returns.

The horizon is itself an inference from silence, which is exactly the class of inference the rest of this change removes.
The takeover-aware wording is what keeps that honest, and it now carries the whole weight: the recovery section is never hidden, because it is the only place the recovery prompt and connector command are rendered and hiding it would leave a reviewer with no route back.
Instead its copy changes. While a claim still explains the quiet the section reads **Connect an agent and take over this work** and says plainly that the agent may still be working, may finish on its own, and that connecting a session discards what it was doing so its answer will no longer be accepted; past the horizon it returns to the plain **Reconnect your agent** instruction.
The reviewer chooses with the adr/0002 consequence in front of them rather than being nudged into it.

One piece of fallout is worth naming. Making `stalled` reachable also made the persistent chrome's alert reachable on every ordinary long turn, and that alert was hardcoded to danger. It now takes the activity's own tone, so a quiet turn renders as warning. The two tones must stay distinguishable by their labels - "Agent not responding" against "Agent disconnected" - and never by colour alone, so the warning variant must not later be given the danger glyph to make them look consistent.

## Matrix rows affected

| Case                                         | What the reviewer sees now                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Agent mid-long-turn, no protocol traffic  | Activity card reads **Agent may be stalled** with the quiet duration; chrome reads **Agent not responding** in the warning tone, not danger red. The thread reads **No progress for *N*m**. The connection card reads **No recent agent signal**. The recovery section is on screen but warns that the agent may still be working and that connecting a session takes the work over. The answer is accepted when it lands.                                                                                                                                                                                                                      |
| 4. Agent process killed mid-turn             | Identical to case 1 for the first 30 minutes, and deliberately so: neither a slow agent nor a stopped one produces a signal, so claiming a disconnection would be the same unfounded assertion this bug is about. The claim being abandoned never makes a later session report a connection. Past the recovery horizon the pickup stops explaining the quiet: the activity card falls through to the ordinary presence answer, the thread drops its promise to resolve itself and leaves the working group, new messages read **Blocked - no agent connected**, and the recovery section returns to its plain **Reconnect your agent** wording. |
| 5. Claim lapse and re-claim (connection log) | The runtime still records a presence edge whenever the heartbeat ages out, because presence genuinely stopped. The log narrates it as a quiet period rather than as a disconnect and a reconnect: rows read **No signal**, durations read **Quiet for _N_** and **Signal returned after _N_ quiet**, the summary counts quiet periods and resumptions, and the stored reason reads **No agent signal within 75 seconds**.                                                                                                                                                                                                                       |
| 8. A second message sent during a quiet turn | Reads **Queued, _N_ ahead** rather than **Blocked - no agent connected**, because held work explains the silence and the question is a queue position, not a connection verdict. Once the holding claim passes the recovery horizon it reads blocked again, because nothing is left to queue behind.                                                                                                                                                                                                                                                                                                                                            |
| 9. Two claims, one abandoned and one working | The activity card describes the most recent pickup, not the oldest claim. Before this, a dead R1 and a quietly working R2 made the card report R1's request id, R1's much longer quiet duration, and a thread link to R1 while R2 was the turn actually in flight.                                                                                                                                                                                                                                                                                                                                                                              |

Cases 2, 3, 6 and 7 are unchanged from the original notes.
