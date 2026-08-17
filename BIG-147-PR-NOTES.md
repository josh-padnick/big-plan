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

## Matrix rows affected

| Case                                         | What the reviewer sees now                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Agent mid-long-turn, no protocol traffic  | Activity card reads **Agent may be stalled** with the quiet duration; chrome reads **Agent not responding**. The thread reads **No progress for \_N_m**. The connection card reads **No recent agent signal**. The reconnect disclosure is withheld. The answer is accepted when it lands.                                                                                                                                |
| 4. Agent process killed mid-turn             | Identical to case 1, and deliberately so: neither a slow agent nor a stopped one produces a signal, so claiming a disconnection would be the same unfounded assertion this bug is about. The claim being abandoned never makes a later session report a connection.                                                                                                                                                       |
| 5. Claim lapse and re-claim (connection log) | The runtime still records a presence edge whenever the heartbeat ages out, because presence genuinely stopped. The log narrates it as a quiet period rather than as a disconnect and a reconnect: rows read **No signal**, durations read **Quiet for _N_** and **Signal returned after _N_ quiet**, the summary counts quiet periods and resumptions, and the stored reason reads **No agent signal within 75 seconds**. |
| 8. A second message sent during a quiet turn | Reads **Queued, _N_ ahead** rather than **Blocked - no agent connected**, because held work explains the silence and the question is a queue position, not a connection verdict.                                                                                                                                                                                                                                          |

Cases 2, 3, 6 and 7 are unchanged from the original notes.
