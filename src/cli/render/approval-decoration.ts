// Decides whether one static export carries the approved stamp.
//
// A rendered file is a copy that outlives the review that produced it, so the
// question it has to answer is narrower than the one the live page answers:
// not "has this plan ever been approved" but "is the approval in force pinned
// to exactly the bytes being rendered". A stale approval stamps nothing,
// because a mark on a plan that changed after signing is the one failure this
// surface must never produce.

import { deriveSnapshotDigest } from "../../review/agent-exchange.js";
import { validateApprovalRecord } from "../../review/approval-record.js";
import {
  deriveApprovalStatus,
  inForceApproval,
} from "../../review/shared/approval.js";
import {
  deriveReviewPlanId,
  readApprovalRecord,
  reviewStoreFor,
} from "../../review/store.js";
import type { ApprovalDecoration } from "../../render/render-document.js";

/**
 * The approval to stamp into this export, or nothing.
 *
 * Nothing is the answer for a plan with no review store beside it, a store
 * with no approval in force, and an approval whose pinned digest no longer
 * matches the source. A store this build cannot read is answered the same way:
 * an export is a derived artifact, and refusing to produce one over an
 * unreadable side file would be a worse failure than omitting the mark.
 */
export const approvalDecorationFor = async ({
  planPath,
  markdown,
}: {
  readonly planPath: string;
  readonly markdown: string;
}): Promise<ApprovalDecoration | undefined> => {
  let store;
  try {
    store = reviewStoreFor({
      planPath,
      planId: deriveReviewPlanId({ planPath }),
    });
  } catch {
    return undefined;
  }
  const { record } = await readApprovalRecord({
    store,
    validate: validateApprovalRecord,
  });
  const entry = inForceApproval(record);
  const status = deriveApprovalStatus({
    entry,
    currentSnapshot: deriveSnapshotDigest(markdown),
  });
  if (entry === undefined || status !== "approved") return undefined;
  return { at: entry.at, pinnedSnapshot: entry.pinnedSnapshot };
};
