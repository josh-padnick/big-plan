// Owns the browser-safe facts that distinguish queued reviewer work from a
// request the agent has started, and that decide when a pickup stops holding
// the reviewer's message.

import { claimIsAbandoned, type ClaimedRequest } from "./agent-claim.js";

export type OwnableRequest = {
  readonly claimedAt?: string;
};

/** True once an agent has picked this request up, whenever that was. */
export const agentOwnsRequest = (request: OwnableRequest): boolean =>
  request.claimedAt !== undefined;

/**
 * True while a pickup still bars the reviewer from editing or deleting the
 * message. Pickup alone used to be the whole answer, which left one dead
 * agent's claim locking a message forever; a claim proven abandoned releases
 * the message back to the reviewer, and nothing short of that proof does.
 *
 * This is the mailbox's refusal and the reviewer's offered affordance in one
 * definition, so what the browser offers and what the server accepts cannot
 * drift apart (BIG-120).
 */
export const agentStillOwnsRequest = ({
  request,
  agentConnected,
  nowMs,
}: {
  readonly request: OwnableRequest & ClaimedRequest;
  /** Whether the presence lease reports an agent attached right now. */
  readonly agentConnected: boolean;
  readonly nowMs: number;
}): boolean =>
  agentOwnsRequest(request) &&
  !claimIsAbandoned({ request, agentConnected, nowMs });
