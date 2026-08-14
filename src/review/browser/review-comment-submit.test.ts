import { describe, expect, it } from "vitest";
import { deriveReviewCommentSubmitAvailability } from "./review-comment-submit.js";

describe("review comment submit availability", () => {
  it("should identify review-runtime unavailability without blaming the agent", () => {
    const availability = deriveReviewCommentSubmitAvailability({
      canSubmit: false,
      runtimeCanWrite: false,
    });

    expect(availability).toEqual({
      state: "unavailable",
      reason: "review-runtime",
      label: "Review session offline",
      status:
        "The review session is offline. Your comment is saved and can be sent after reconnecting.",
    });
  });

  it("should preserve agent-disconnected behavior when the runtime can write", () => {
    const availability = deriveReviewCommentSubmitAvailability({
      canSubmit: false,
      runtimeCanWrite: true,
    });

    expect(availability).toEqual({
      state: "unavailable",
      reason: "agent",
      label: "Agent disconnected",
      status:
        "Agent disconnected. Your comment is saved and can be sent after reconnecting.",
    });
  });

  it("should remain available when submission is allowed", () => {
    expect(
      deriveReviewCommentSubmitAvailability({
        canSubmit: true,
        runtimeCanWrite: false,
      }),
    ).toEqual({ state: "available" });
  });
});
