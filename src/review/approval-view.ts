// Reads the approval in force the way every reviewer surface has to see it,
// which is one fact more than the record holds: whether the agent was handed
// it. The record commits before the mailbox write, so the two can disagree, and
// a surface that assumed delivery would assert it on every load after the one
// where the failure was reported.

import {
  approvalSummary,
  inForceApproval,
  type ApprovalRecord,
  type ApprovalSummary,
} from "./shared/approval.js";
import { hasAgentRequest } from "./store.js";
import type { ReviewStore } from "./store.js";

/**
 * Whether the handoff for this approval is in the mailbox.
 *
 * A mailbox that cannot be read cannot prove delivery.
 */
const approvalWasDelivered = async ({
  store,
  approvalId,
}: {
  readonly store: ReviewStore;
  readonly approvalId: string;
}): Promise<boolean> =>
  hasAgentRequest({ store, requestId: approvalId }).catch(() => false);

/** The browser-facing summary of the approval in force, delivery included. */
export const readApprovalSummary = async ({
  store,
  record,
  currentSnapshot,
}: {
  readonly store: ReviewStore;
  readonly record: ApprovalRecord;
  readonly currentSnapshot: string;
}): Promise<ApprovalSummary | undefined> => {
  const entry = inForceApproval(record);
  if (entry === undefined) return undefined;
  return approvalSummary({
    record,
    currentSnapshot,
    delivered: await approvalWasDelivered({
      store,
      approvalId: entry.approvalId,
    }),
  });
};
