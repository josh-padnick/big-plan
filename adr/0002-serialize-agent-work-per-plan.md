<!--
Owns why Big Plan serializes agent work per plan and the condition for restoring
concurrent plan editing.
-->

# ADR 0002: Serialize agent work per plan

- Status: Accepted
- Date: 2026-08-15
- Amended: 2026-08-17, when BIG-122 delivered the staged-write boundary
- Amended: 2026-08-18, when BIG-159 made cancellation release the plan

## Context

A live review request authorizes a coding agent to edit one authoritative MDX plan source.
Big Plan must not lose a reviewer's message or let the durable queue disagree with the state shown to the reviewer.
Without a shared source-mutation boundary, parallel agents can read the same plan and write incompatible revisions over each other.

Parallel per-request claims with optimistic conflict detection at answer time were implemented during the request-protocol work.
That design was withdrawn after it proved unable to close the lost-update window.
Plan-source writes occur outside the terminal lock, so an answer-time check races the source write it exists to detect.
The check can narrow the window but cannot guarantee that a successful answer preserved another agent's accepted edits.

## Decision

Big Plan permits one live request claim per plan, so pickup is serialized across that plan.
A per-pickup agent token is the claim identity.
The token holder may resume its request, renew the lease through progress notes, and commit the response.
A second agent waits until the holder's request is answered or canceled, or the lease lapses, instead of editing the plan in parallel.
A lapsed claim may be taken over, and the takeover is disclosed through the progress channel.

The request file is the single terminal commit point.
The response is staged first, and `answeredAt` is written to the request last.
Request terminality has one authority: `answeredAt` or `canceledAt` on the request.
Pickup has one authority: a live durable claim.
Readers do not infer either fact from response-file presence, progress events, process presence, or presentation-shaped history.

Serialization gives up the approved mechanism of parallel claims to preserve the higher-order guarantee that no reviewer message is silently lost.
Until source writes have a sound shared boundary, serialization is the only bounded design that excludes ordinary concurrent unfenced writers.

## Pickup release rule

The plan-wide pickup block releases when the writer can no longer reach the plan source, not merely when the request is terminal.
Both terminal outcomes prove that, for different reasons.
An answered request releases immediately because the agent finished editing and said so.
A canceled request releases immediately because the terminal commit refuses a canceled request outright and cancellation drops the claim stages that request opened, so its holder is fenced out of the plan whether or not it has noticed the cancellation yet.

This rule originally kept a canceled request blocking until its lease lapsed, on the reasoning that the editing agent may not learn about the cancellation until its next note or response.
The staged-write invariant below replaced that reasoning: a canceled holder is fenced out more completely than a displaced one, so the block bought no safety and cost the reviewer a stalled queue, with the next message sitting queued for the rest of the lease (BIG-159).

## Staged-write invariant

This section replaces the residual risk this decision originally accepted.
BIG-122 delivered the staged-write boundary that risk was waiting on, so a lapsed lease no longer reaches the plan.

Every supported agent edit is made in a claim-scoped private stage, and one Big Plan component is the plan file's only writer.
A claim carries a monotonic generation that a takeover raises and a renewal keeps.
Publication happens under one plan-mutation lock, taken before the request lock, and requires three things at once: the recorded holder, the generation the answer was drafted for, and a plan source whose digest still equals the candidate's base.
The publication itself is one atomic rename, preceded by a prepared transaction journal carrying the validated response and the digests on both sides of that rename.

The consequences for this decision are:

- A displaced agent may keep editing its own candidate, and none of it can reach the plan.
- A takeover's baseline is the last published revision, so **Was**/**Now** cannot attribute the previous agent's work to the new one.
- An interrupted commit has one answer, settled before the runtime or any agent command is served: the response completes if the rename won, the request stays open at its base revision if it did not, and a source matching neither digest stops agent writes with a typed external-source conflict rather than being overwritten.

This protocol covers writes made through the supported agent workflow.
A process running with the same local user rights can still alter any user-owned file outside Big Plan, and that remains out of scope.

## Rejected alternatives

### Parallel claims with answer-time conflict detection

This alternative was implemented and then withdrawn.
Because plan-source writes occur outside the terminal lock, optimistic validation at terminal commit races the write it is meant to validate and cannot eliminate silent lost updates.

### Accept and document silent lost updates

This alternative was refused.
It would weaken the guarantee that no reviewer message is lost on the normal path created by the feature itself.

### Stage or fence source mutations

This alternative was deferred as BIG-122 rather than rejected in principle, and BIG-122 has since delivered it.
It is recorded above as the staged-write invariant.

## Consequences

- Only one agent works on a plan at a time, although other agents may wait for queued work.
- Per-pickup tokens, lease renewal, resumption, terminal ownership checks, and lapsed-claim takeover remain necessary within the serialized design.
- Either terminal outcome releases the plan immediately, so the queue advances when a request is answered or canceled rather than when a lease expires.
- The shared source-mutation boundary BIG-122 was required to provide now exists, so the precondition for restoring concurrent plan editing is met.
- Serialization itself is not lifted here. Concurrent claims need their own decision about merge policy, conflict presentation, and reviewer experience; the write boundary makes that decision possible, not automatic.
- The lapsed-lease takeover interleave is closed rather than accepted.
