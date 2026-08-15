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
  it("should tell a reviewer to restart when the runtime stopped accepting changes", () => {
    const availability = deriveReviewCommentSubmitAvailability({
      canSubmit: false,
      runtimeCanWrite: true,
      writesStalled: true,
    });

    expect(availability).toEqual({
      state: "unavailable",
      reason: "review-runtime",
      label: "Review session stalled",
      status:
        "The review session has stopped accepting changes. Your comment is saved; restart the review runtime to send it.",
    });
  });

  it("should report an unreachable runtime as offline rather than stalled", () => {
    const availability = deriveReviewCommentSubmitAvailability({
      canSubmit: false,
      runtimeCanWrite: false,
      writesStalled: true,
    });

    expect(availability).toMatchObject({ label: "Review session offline" });
  });

  it("should stay available when a stalled runtime can still submit", () => {
    expect(
      deriveReviewCommentSubmitAvailability({
        canSubmit: true,
        runtimeCanWrite: true,
        writesStalled: true,
      }),
    ).toEqual({ state: "available" });
  });
});
