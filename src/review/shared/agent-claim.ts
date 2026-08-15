// Owns the claim-lease vocabulary shared by the mailbox, the exchange reader,
// and the reader-facing projection. It derives facts from a stored claim and
// the current time. It stores no state and does not depend on the browser or
// Node.

import { AGENT_STALL_MS } from "./agent-status.js";

// A claim lasts exactly as long as the window after which the reviewer is
// already told the agent has stopped. Taking a claim the reviewer has been
// shown as stalled is consistent with what they have been told, and it means
// the lease needs no timer of its own: the working heartbeat that keeps the
// agent presented as live is the same signal that renews the claim.
export const AGENT_CLAIM_LEASE_MS = AGENT_STALL_MS;

export type ClaimedRequest = {
  readonly claimedBy?: string;
  readonly claimExpiresAtMs?: number;
};

/** The instant a claim taken now would lapse without a renewal. */
export const claimLeaseExpiryMs = (nowMs: number): number =>
  nowMs + AGENT_CLAIM_LEASE_MS;

/** True while a request carries a claim that has not yet lapsed. */
export const claimIsLive = ({
  request,
  nowMs,
}: {
  readonly request: ClaimedRequest;
  readonly nowMs: number;
}): boolean =>
  request.claimExpiresAtMs !== undefined && request.claimExpiresAtMs > nowMs;

/** True when a live claim belongs to some agent session other than this one. */
export const claimIsHeldByAnother = ({
  request,
  claimedBy,
  nowMs,
}: {
  readonly request: ClaimedRequest;
  readonly claimedBy: string;
  readonly nowMs: number;
}): boolean =>
  claimIsLive({ request, nowMs }) && request.claimedBy !== claimedBy;
