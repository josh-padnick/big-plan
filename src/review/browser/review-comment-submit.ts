// Owns the review view's comment-submit availability and user-facing reason.
// Why a write cannot land is not this module's question: it defers to the
// shared write-availability predicate so the composer and every other mutation
// path blame the same condition in the same words.

import {
  reviewWriteBlock,
  reviewWriteBlockedStatus,
  reviewWritePathOutcome,
  type ReviewWriteAvailability,
} from "./review-write-availability.js";
import {
  REVIEW_SESSION_UNREACHABLE_HEADLINE,
  REVIEW_SESSION_UNREACHABLE_SUPPORTING,
} from "../shared/agent-status.js";

export type ReviewCommentSubmitAvailability =
  | { readonly state: "available" }
  | {
      readonly state: "unavailable";
      readonly reason: "review-runtime" | "agent";
      readonly label: string;
      readonly status: string;
    };

/** What becomes of a comment the reviewer cannot send yet. */
const COMMENT_OUTCOME = reviewWritePathOutcome("submit-comment");

export const deriveReviewCommentSubmitAvailability = ({
  canSubmit,
  runtimeIsUnreachable,
  writeAvailability,
}: {
  readonly canSubmit: boolean;
  readonly runtimeIsUnreachable: boolean;
  readonly writeAvailability: ReviewWriteAvailability;
}): ReviewCommentSubmitAvailability => {
  if (canSubmit) return { state: "available" };
  const block = reviewWriteBlock(writeAvailability);
  // Writes can land, so the runtime is not what is missing: the agent is.
  if (block === undefined) {
    if (runtimeIsUnreachable) {
      return {
        state: "unavailable",
        reason: "review-runtime",
        label: REVIEW_SESSION_UNREACHABLE_HEADLINE,
        status: `${REVIEW_SESSION_UNREACHABLE_HEADLINE}. ${COMMENT_OUTCOME} ${REVIEW_SESSION_UNREACHABLE_SUPPORTING}`,
      };
    }
    return {
      state: "unavailable",
      reason: "agent",
      label: "Agent disconnected",
      status: `Agent disconnected. ${COMMENT_OUTCOME} It can be sent after reconnecting.`,
    };
  }
  return {
    state: "unavailable",
    reason: "review-runtime",
    label: block.label,
    status: reviewWriteBlockedStatus({ block, outcome: COMMENT_OUTCOME }),
  };
};
