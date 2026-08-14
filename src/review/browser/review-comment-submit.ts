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
}: {
  readonly canSubmit: boolean;
  readonly runtimeCanWrite: boolean;
}): ReviewCommentSubmitAvailability => {
  if (canSubmit) return { state: "available" };
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
