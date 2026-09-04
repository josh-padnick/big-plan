import { describe, expect, it } from "vitest";
import { deriveReviewCommentSubmitAvailability } from "./review-comment-submit.js";
import {
  REVIEW_WRITES_AVAILABLE,
  reviewWriteAvailability,
  type ReviewWriteAvailability,
} from "./review-write-availability.js";

const OFFLINE: ReviewWriteAvailability = reviewWriteAvailability({
  hasReviewSession: true,
  health: {
    state: "runtime-unavailable",
    consecutiveFailures: 2,
    firstFailureAtMs: 0,
  },
  writesStalledMs: undefined,
  authoritative: true,
});
const OUT_OF_DATE: ReviewWriteAvailability = reviewWriteAvailability({
  hasReviewSession: true,
  health: { state: "poll-failed", consecutiveFailures: 2 },
  writesStalledMs: undefined,
  authoritative: true,
});
const STALLED: ReviewWriteAvailability = reviewWriteAvailability({
  hasReviewSession: true,
  health: { state: "healthy" },
  writesStalledMs: 30_001,
  authoritative: true,
});

describe("review comment submit availability", () => {
  it("should identify review-runtime unavailability without blaming the agent", () => {
    const availability = deriveReviewCommentSubmitAvailability({
      canSubmit: false,
      writeAvailability: OFFLINE,
    });

    expect(availability).toEqual({
      state: "unavailable",
      reason: "review-runtime",
      label: "Review session unreachable",
      status:
        "Review session unreachable. Your comment is saved. Restart `big-plan review`, then open the new URL it prints. All comments are safe.",
    });
  });

  it("should preserve agent-disconnected behavior when the runtime can write", () => {
    const availability = deriveReviewCommentSubmitAvailability({
      canSubmit: false,
      writeAvailability: REVIEW_WRITES_AVAILABLE,
    });

    expect(availability).toEqual({
      state: "unavailable",
      reason: "agent",
      label: "Agent disconnected",
      status:
        "Agent disconnected. Your comment is saved. It can be sent after reconnecting.",
    });
  });

  it("should remain available when submission is allowed", () => {
    expect(
      deriveReviewCommentSubmitAvailability({
        canSubmit: true,
        writeAvailability: OFFLINE,
      }),
    ).toEqual({ state: "available" });
  });

  it("should tell a reviewer to restart when the runtime stopped accepting changes", () => {
    const availability = deriveReviewCommentSubmitAvailability({
      canSubmit: false,
      writeAvailability: STALLED,
    });

    expect(availability).toEqual({
      state: "unavailable",
      reason: "review-runtime",
      label: "Review session stalled",
      status:
        "The review session has stopped accepting changes. Your comment is saved. Restart the review runtime to continue.",
    });
  });

  it("should stay available when a stalled runtime can still submit", () => {
    expect(
      deriveReviewCommentSubmitAvailability({
        canSubmit: true,
        writeAvailability: STALLED,
      }),
    ).toEqual({ state: "available" });
  });

  it("should tell a reviewer to reload when the runtime refuses this tab", () => {
    // Refused polls are a block of their own, so the composer reads it from
    // the gate like every other block instead of asking poll health a second
    // question (BIG-282).
    const availability = deriveReviewCommentSubmitAvailability({
      canSubmit: false,
      writeAvailability: OUT_OF_DATE,
    });

    expect(availability).toEqual({
      state: "unavailable",
      reason: "review-runtime",
      label: "Review session out of date",
      status:
        "This tab's review session is out of date. Your comment is saved. Reload this page to reconnect. All comments are safe.",
    });
  });
});
