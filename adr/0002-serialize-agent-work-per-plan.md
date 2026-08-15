<!--
Owns why Big Plan serializes agent work per plan and the condition for restoring
concurrent plan editing.
-->

# ADR 0002: Serialize agent work per plan

- Status: Accepted
- Date: 2026-08-15

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
A second agent waits until the holder answers or the lease lapses instead of editing the plan in parallel.
A lapsed claim may be taken over, and the takeover is disclosed through the progress channel.

The request file is the single terminal commit point.
The response is staged first, and `answeredAt` is written to the request last.
Request terminality has one authority: `answeredAt` or `canceledAt` on the request.
Pickup has one authority: a live durable claim.
Readers do not infer either fact from response-file presence, progress events, process presence, or presentation-shaped history.

Serialization gives up the approved mechanism of parallel claims to preserve the higher-order guarantee that no reviewer message is silently lost.
Until source writes have a sound shared boundary, serialization is the only bounded design that excludes ordinary concurrent unfenced writers.

## Pickup release rule

The plan-wide pickup block releases when the writer is provably gone, not merely when the request is terminal.
An answered request releases immediately because the agent finished editing and said so.
A canceled request with a live lease keeps blocking until the lease expires because cancellation is a reviewer action that the editing agent may not learn about until its next note or response.
Treating cancellation as an immediate release would allow a new agent to edit while the canceled agent may still be writing.

## Accepted residual risk

A lease can lapse while an agent is genuinely mid-edit.
The taking-over agent's baseline may therefore include partial edits from the previous agent, and the reviewer's **Was**/**Now** comparison can attribute those edits to the new agent.
Progress-note renewal reduces this risk, and the takeover narration discloses the possible interleaving to the reviewer.
The protocol does not fence those plan writes because staged or fenced source mutation is deferred to BIG-122.

## Rejected alternatives

### Parallel claims with answer-time conflict detection

This alternative was implemented and then withdrawn.
Because plan-source writes occur outside the terminal lock, optimistic validation at terminal commit races the write it is meant to validate and cannot eliminate silent lost updates.

### Accept and document silent lost updates

This alternative was refused.
It would weaken the guarantee that no reviewer message is lost on the normal path created by the feature itself.

### Stage or fence source mutations

This alternative is deferred as BIG-122 rather than rejected in principle.
A sound staged or fenced write boundary is the condition under which concurrent claims may return.
Until that boundary exists, documentation alone or partial answer-time detection is insufficient.

## Consequences

- Only one agent works on a plan at a time, although other agents may wait for queued work.
- Per-pickup tokens, lease renewal, resumption, terminal ownership checks, and lapsed-claim takeover remain necessary within the serialized design.
- Answered requests release the plan immediately, while canceled requests with live leases continue to block pickup until expiry.
- BIG-122 must provide a shared source-mutation boundary before this decision can be amended to restore concurrent plan editing.
- The lapsed-lease takeover interleave remains an accepted and reviewer-visible risk until that boundary exists.
