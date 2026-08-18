// Owns the claim-lease vocabulary shared by the mailbox, the exchange reader,
// and the reader-facing projection. It derives facts from a stored claim, the
// current time, and - for abandonment alone - whether an agent is attached. It
// stores no state and does not depend on the browser or Node.

import { AGENT_RECOVERY_HORIZON_MS, AGENT_STALL_MS } from "./agent-timing.js";

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

/** The durable signal time encoded by the lease's expiry. */
export const claimSignalAtMs = (request: ClaimedRequest): number | undefined =>
  request.claimExpiresAtMs === undefined ||
  !Number.isFinite(request.claimExpiresAtMs)
    ? undefined
    : request.claimExpiresAtMs - AGENT_CLAIM_LEASE_MS;

/** True while a request carries a claim that has not yet lapsed. */
export const claimIsLive = ({
  request,
  nowMs,
}: {
  readonly request: ClaimedRequest;
  readonly nowMs: number;
}): boolean =>
  claimSignalAtMs(request) !== undefined &&
  (request.claimExpiresAtMs ?? 0) > nowMs;

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

/**
 * True once an agent has picked a request up, lease still live or not. Pickup
 * is what the reviewer is told about, and a lapsed lease does not undo it:
 * `agent next` hands the work over and its process exits, so between two
 * progress notes nothing is left to renew the claim (BIG-147).
 */
export const requestWasClaimed = (request: ClaimedRequest): boolean =>
  request.claimedBy !== undefined && claimSignalAtMs(request) !== undefined;

/**
 * How long a claim has gone without a signal, measured from the claim's own
 * last narration. Never from the lease: a quiet turn's lease is lapsed by
 * definition, so a lease test would answer "no" exactly when the question
 * matters (BIG-147).
 */
export const claimQuietForMs = ({
  request,
  nowMs,
}: {
  readonly request: ClaimedRequest;
  readonly nowMs: number;
}): number | undefined => {
  const signalAtMs = claimSignalAtMs(request);
  return signalAtMs === undefined ? undefined : Math.max(0, nowMs - signalAtMs);
};

/**
 * True while this claim still accounts for an agent's silence. Pickup explains
 * quiet only within the recovery horizon; past it the claim has stopped saying
 * anything about why nothing is being reported.
 */
export const claimExplainsQuiet = ({
  request,
  nowMs,
}: {
  readonly request: ClaimedRequest;
  readonly nowMs: number;
}): boolean => {
  if (!requestWasClaimed(request)) return false;
  const quietFor = claimQuietForMs({ request, nowMs });
  return quietFor !== undefined && quietFor <= AGENT_RECOVERY_HORIZON_MS;
};

/**
 * True once a claim is provably abandoned: no agent is attached, and the
 * pickup has gone quiet for longer than a pickup can account for.
 *
 * Both halves are required, because neither is evidence on its own. A lapsed
 * lease proves nothing - `agent next` hands the work over and exits, so every
 * ordinary turn lets the lease lapse - and a plan-wide silence proves nothing
 * while an agent is attached, because the attached session may be the holder.
 * Past the recovery horizon the pickup has already stopped explaining the
 * quiet everywhere the reviewer can see it, so the remaining reading is that
 * the claim outlived the agent that took it (BIG-147).
 *
 * A claim stored without its lease can never be proven abandoned, which is the
 * safe direction: what cannot be proven keeps the request locked.
 */
export const claimIsAbandoned = ({
  request,
  agentConnected,
  nowMs,
}: {
  readonly request: ClaimedRequest;
  /** Whether the presence lease reports an agent attached right now. */
  readonly agentConnected: boolean;
  readonly nowMs: number;
}): boolean =>
  !agentConnected &&
  requestWasClaimed(request) &&
  !claimExplainsQuiet({ request, nowMs });
