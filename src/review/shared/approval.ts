// Owns what an approval means: the append-only log, the entry still in force,
// and the status derived from pinning that entry to the plan as it reads now.
//
// Status is never stored. An approval is current exactly while its pinned
// digest equals the source on disk; a later edit changes the digest and the
// status follows, so no path has to remember to un-set a flag.

import { SNAPSHOT_DIGEST } from "./change-verdict.js";
import { APPROVAL_MESSAGE_LIMIT } from "./approval-message.js";

/** How the latest non-revoked approval sits against the plan on disk. */
export type ApprovalStatus = "none" | "approved" | "stale";

/** One decision this approval recorded, in the reviewer's words. */
export type RecordedApprovalAnswer = {
  readonly decisionId: string;
  readonly optionId: string;
  readonly optionTitle: string;
};

/** A decision that was already decided in source before this approval. */
export type AlreadyDecidedAnswer = {
  readonly decisionId: string;
  readonly optionId: string;
};

/** Counts the reviewer saw at the moment of signing. */
export type ApprovalOpenItemCounts = {
  readonly changeSetsAccepted: number;
  readonly changeSetsTotal: number;
  readonly decisionsAnswered: number;
  readonly decisionsTotal: number;
  readonly requestsCanceled: number;
};

/** One successful approval, pinned to a snapshot. */
export type ApprovalEntry = {
  readonly kind: "approval";
  readonly approvalId: string;
  readonly at: string;
  readonly pinnedSnapshot: string;
  readonly agentConnected: boolean;
  readonly message: string;
  readonly recordedAnswers: ReadonlyArray<RecordedApprovalAnswer>;
  readonly alreadyDecided: ReadonlyArray<AlreadyDecidedAnswer>;
  readonly unansweredDecisions: ReadonlyArray<string>;
  readonly openItemCounts: ApprovalOpenItemCounts;
};

/** Cancels the named approval. Later re-approval is a new entry. */
export type RevocationEntry = {
  readonly kind: "revocation";
  readonly approvalId: string;
  readonly at: string;
};

export type ApprovalLogEntry = ApprovalEntry | RevocationEntry;

/**
 * One approval as the details popover lists it: when it was signed, what it
 * pinned, and whether a later revocation cancelled it. Derived, never stored,
 * for the same reason status is - the log holds entries, not conclusions.
 */
export type ApprovalHistoryItem = {
  readonly approvalId: string;
  readonly at: string;
  readonly pinnedSnapshot: string;
  /** When a revocation cancelled this approval; absent while it still stands. */
  readonly revokedAt?: string;
};

/** The append-only log a review keeps of its approvals. */
export type ApprovalRecord = {
  readonly version: 1;
  readonly entries: ReadonlyArray<ApprovalLogEntry>;
};

/**
 * What a browser needs to paint the approved or stale state. Absent when no
 * approval is in force, including after revoke.
 */
export type ApprovalSummary = {
  readonly approvalId: string;
  readonly at: string;
  readonly pinnedSnapshot: string;
  readonly status: "approved" | "stale";
  readonly message: string;
  /**
   * Whether the agent was actually handed this approval. The record commits
   * before the mailbox write, so an approval can be in force with no handoff
   * behind it, and every surface that speaks for the approval reads this rather
   * than assuming delivery (BIG-131).
   */
  readonly delivered: boolean;
  readonly openItemCounts: ApprovalOpenItemCounts;
  /**
   * Every approval this review has ever recorded, newest first, so the details
   * popover can show that the plan was approved before rather than implying
   * the entry in force is the only one that ever existed.
   */
  readonly history: ReadonlyArray<ApprovalHistoryItem>;
};

export const APPROVAL_ID = /^[a-f0-9]{16}$/u;

export const emptyApprovalRecord = (): ApprovalRecord => ({
  version: 1,
  entries: [],
});

/**
 * The approval still in force: the latest approval, unless a later
 * revocation names it. Revoking the current approval returns the review to
 * none rather than resurrecting an earlier pin; earlier entries stay as
 * history only.
 */
export const inForceApproval = (
  record: ApprovalRecord,
): ApprovalEntry | undefined => {
  let latest: ApprovalEntry | undefined;
  let latestIndex = -1;
  for (const [index, entry] of record.entries.entries()) {
    if (entry.kind === "approval") {
      latest = entry;
      latestIndex = index;
    }
  }
  if (latest === undefined) return undefined;
  const latestId = latest.approvalId;
  const revoked = record.entries
    .slice(latestIndex + 1)
    .some(
      (entry) => entry.kind === "revocation" && entry.approvalId === latestId,
    );
  return revoked ? undefined : latest;
};

/**
 * Every approval in the log, newest first, each carrying the revocation that
 * cancelled it. A revocation naming no approval before it is log corruption
 * the reader cannot place, so it is dropped rather than shown against the
 * wrong entry.
 */
export const approvalHistory = (
  record: ApprovalRecord,
): ReadonlyArray<ApprovalHistoryItem> => {
  const revokedAtById = new Map<string, string>();
  const seenApprovalIds = new Set<string>();
  for (const entry of record.entries) {
    if (entry.kind === "approval") {
      seenApprovalIds.add(entry.approvalId);
      continue;
    }
    if (
      seenApprovalIds.has(entry.approvalId) &&
      !revokedAtById.has(entry.approvalId)
    ) {
      revokedAtById.set(entry.approvalId, entry.at);
    }
  }
  const items: ApprovalHistoryItem[] = [];
  for (const entry of record.entries) {
    if (entry.kind !== "approval") continue;
    const revokedAt = revokedAtById.get(entry.approvalId);
    items.push({
      approvalId: entry.approvalId,
      at: entry.at,
      pinnedSnapshot: entry.pinnedSnapshot,
      ...(revokedAt === undefined ? {} : { revokedAt }),
    });
  }
  return items.reverse();
};

/** Pins an in-force approval to the source digest the runtime just read. */
export const deriveApprovalStatus = ({
  entry,
  currentSnapshot,
}: {
  readonly entry: ApprovalEntry | undefined;
  readonly currentSnapshot: string;
}): ApprovalStatus => {
  if (entry === undefined) return "none";
  return entry.pinnedSnapshot === currentSnapshot ? "approved" : "stale";
};

/** The browser-facing summary, or nothing when status is none. */
export const approvalSummary = ({
  record,
  currentSnapshot,
  delivered,
}: {
  readonly record: ApprovalRecord;
  readonly currentSnapshot: string;
  /** Whether this approval reached the agent mailbox. */
  readonly delivered: boolean;
}): ApprovalSummary | undefined => {
  const entry = inForceApproval(record);
  const status = deriveApprovalStatus({ entry, currentSnapshot });
  if (entry === undefined || status === "none") return undefined;
  return {
    approvalId: entry.approvalId,
    at: entry.at,
    pinnedSnapshot: entry.pinnedSnapshot,
    status,
    message: entry.message,
    delivered,
    openItemCounts: entry.openItemCounts,
    history: approvalHistory(record),
  };
};

/** True when a string is a digest this record can pin. */
export const isApprovalSnapshot = (value: unknown): value is string =>
  typeof value === "string" && SNAPSHOT_DIGEST.test(value);

/** True when a covering note is within the stored bound. */
export const isApprovalMessage = (value: unknown): value is string =>
  typeof value === "string" && value.length <= APPROVAL_MESSAGE_LIMIT;
