// Owns the one question every explicit mutation path asks before it submits:
// could a write sent right now still be accepted? Reachability alone cannot
// answer it, because a runtime that has given up on a stalled write and a
// runtime a newer one replaced both keep answering every read the page polls.
// Without this the page submits doomed mutations that fail visibly but late,
// after the reviewer has already been told the action was under way.

import {
  reviewRuntimeAcceptsWrites,
  reviewRuntimeCanWrite,
  type ReviewPollHealth,
} from "./review-poll-health.js";

/** Why a write cannot land, most durable condition first. */
export type ReviewWriteBlock =
  | "no-review-session"
  | "session-replaced"
  | "runtime-offline"
  | "writes-stalled";

export type ReviewWriteBlocked = {
  readonly state: "unavailable";
  readonly block: ReviewWriteBlock;
  /** Why writes cannot land, in the reviewer's terms. */
  readonly cause: string;
  /** What clears the block. Never a promise that waiting alone is enough. */
  readonly remedy: string;
  /** Short chip text for a control that names the block in place. */
  readonly label: string;
};

export type ReviewWriteAvailability =
  { readonly state: "available" } | ReviewWriteBlocked;

export const REVIEW_WRITES_AVAILABLE = {
  state: "available",
} as const satisfies ReviewWriteAvailability;

const BLOCKS = {
  "no-review-session": {
    cause: "This plan is open without a live review session.",
    remedy: "Start `big-plan review` to send changes.",
    label: "No review session",
  },
  "session-replaced": {
    cause: "A newer review runtime replaced this session.",
    remedy: "Open the newest review to send changes.",
    label: "Review session replaced",
  },
  /* "Unreachable" throughout, matching the agent surface. The reviewer meets
     this block and the offline agent card in the same moment - the send button
     refuses while the rail explains why - and "offline" against "unreachable"
     read as two separate faults (BIG-273). */
  "runtime-offline": {
    cause: "The review session is unreachable.",
    remedy: "It can accept changes again after reconnecting.",
    label: "Review session unreachable",
  },
  "writes-stalled": {
    cause: "The review session has stopped accepting changes.",
    remedy: "Restart the review runtime to continue.",
    label: "Review session stalled",
  },
} as const satisfies Readonly<
  Record<ReviewWriteBlock, Omit<ReviewWriteBlocked, "state" | "block">>
>;

const blocked = (block: ReviewWriteBlock): ReviewWriteBlocked => ({
  state: "unavailable",
  block,
  ...BLOCKS[block],
});

/**
 * The shared write-availability predicate. Every explicit mutation path -
 * sending, replying, deleting, reverting, canceling, and uploading - consults
 * this one answer, so a reviewer is never told an action started when the
 * runtime has already reported it cannot take one.
 *
 * A replaced session is reported ahead of an unreachable one because it is the
 * only permanent block: a runtime handing custody to a newer one stays replaced
 * however the page's own polling is doing, and its remedy is right either way.
 * A stalled runtime is reported last because only a runtime still answering can
 * report its own stall.
 */
export const reviewWriteAvailability = ({
  hasReviewSession,
  health,
  writesStalledMs,
  authoritative,
}: {
  readonly hasReviewSession: boolean;
  readonly health: ReviewPollHealth;
  readonly writesStalledMs: number | undefined;
  readonly authoritative: boolean | undefined;
}): ReviewWriteAvailability => {
  if (!hasReviewSession) return blocked("no-review-session");
  if (authoritative === false) return blocked("session-replaced");
  if (!reviewRuntimeCanWrite(health)) return blocked("runtime-offline");
  if (!reviewRuntimeAcceptsWrites({ health, writesStalledMs })) {
    return blocked("writes-stalled");
  }
  return REVIEW_WRITES_AVAILABLE;
};

export const reviewWriteBlock = (
  availability: ReviewWriteAvailability,
): ReviewWriteBlocked | undefined =>
  availability.state === "unavailable" ? availability : undefined;

/**
 * The message a blocked path shows instead of submitting. The path supplies
 * what became of the reviewer's input, because only it knows; the block
 * supplies why and what clears it, so no path has to guess either.
 */
export const reviewWriteBlockedStatus = ({
  block,
  outcome,
}: {
  readonly block: ReviewWriteBlocked;
  /** What happened to this path's input, in one sentence. */
  readonly outcome: string;
}): string => `${block.cause} ${outcome} ${block.remedy}`;

/** Every explicit mutation a reviewer can start from the review document. */
export type ReviewWritePath =
  | "submit-comment"
  | "reply"
  | "chat"
  | "delete-comment"
  | "revert-changes"
  | "cancel-request"
  | "disconnect-agent"
  | "agent-primacy"
  | "review-mode"
  | "attach-image";

/**
 * What a refusal leaves behind, per path. Each sentence is a promise the path
 * has to keep: nothing typed is dropped, and nothing is reported as done or
 * under way that the runtime was never asked to do.
 */
const PATH_OUTCOMES = {
  "submit-comment": "Your comment is saved.",
  reply: "Your reply is still in the box.",
  chat: "Your question is still in the box.",
  "delete-comment": "The comment was not deleted.",
  "revert-changes": "The agent's changes were left in place.",
  "cancel-request": "The request is still with the agent.",
  "disconnect-agent": "The agent is still connected.",
  "agent-primacy": "The agents are unchanged.",
  "review-mode": "The review mode was not changed.",
  "attach-image": "The image was not attached.",
} as const satisfies Readonly<Record<ReviewWritePath, string>>;

export const reviewWritePathOutcome = (path: ReviewWritePath): string =>
  PATH_OUTCOMES[path];

/**
 * What one mutation path must say instead of submitting, or `undefined` when
 * it may go ahead. This is the seam every explicit mutation path shares: a
 * path that reworks its transport still asks this before it sends.
 */
export const reviewWriteRefusal = ({
  path,
  availability,
}: {
  readonly path: ReviewWritePath;
  readonly availability: ReviewWriteAvailability;
}): string | undefined => {
  const block = reviewWriteBlock(availability);
  return block === undefined
    ? undefined
    : reviewWriteBlockedStatus({ block, outcome: PATH_OUTCOMES[path] });
};
