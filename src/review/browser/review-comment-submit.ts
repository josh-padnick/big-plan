// Owns the review view's comment-submit availability and user-facing reason.

export type ReviewCommentSubmitAvailability =
  | { readonly state: "available" }
  | {
      readonly state: "unavailable";
      readonly reason: "review-runtime" | "agent";
      readonly label: string;
      readonly status: string;
    };

export const deriveReviewCommentSubmitAvailability = ({
  canSubmit,
  runtimeCanWrite,
  writesStalled = false,
}: {
  readonly canSubmit: boolean;
  readonly runtimeCanWrite: boolean;
  /** The runtime is answering but has stopped accepting changes (BIG-44). */
  readonly writesStalled?: boolean;
}): ReviewCommentSubmitAvailability => {
  if (canSubmit) return { state: "available" };
  // A stalled runtime is not offline, and waiting will not fix it: this is the
  // one unavailable state whose recovery is an action the reviewer must take.
  if (runtimeCanWrite && writesStalled) {
    return {
      state: "unavailable",
      reason: "review-runtime",
      label: "Review session stalled",
      status:
        "The review session has stopped accepting changes. Your comment is saved; restart the review runtime to send it.",
    };
  }
  if (!runtimeCanWrite) {
    return {
      state: "unavailable",
      reason: "review-runtime",
      label: "Review session offline",
      status:
        "The review session is offline. Your comment is saved and can be sent after reconnecting.",
    };
  }
  return {
    state: "unavailable",
    reason: "agent",
    label: "Agent disconnected",
    status:
      "Agent disconnected. Your comment is saved and can be sent after reconnecting.",
  };
};
