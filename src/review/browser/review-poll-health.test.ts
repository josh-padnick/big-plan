// Proves the review poll-health transition keeps runtime availability separate
// from other poll failures and heals after a successful poll.

import { describe, expect, it } from "vitest";
import {
  agentConnectionForReviewPoll,
  INITIAL_REVIEW_POLL_HEALTH,
  reviewPollIsOffline,
  reviewRuntimeCanWrite,
  reviewRuntimeIsDown,
  transitionReviewPollHealth,
  type ReviewPollHealth,
  type ReviewPollResult,
} from "./review-poll-health.js";

const transition = (
  results: ReadonlyArray<ReviewPollResult>,
): ReviewPollHealth =>
  results.reduce<ReviewPollHealth>(
    (health, result) => transitionReviewPollHealth({ health, result }),
    INITIAL_REVIEW_POLL_HEALTH,
  );

describe("review poll health", () => {
  it("should report runtime unavailability after consecutive transport failures", () => {
    const first = transition(["runtime-unavailable"]);
    const second = transition(["runtime-unavailable", "runtime-unavailable"]);

    expect(reviewRuntimeIsDown(first)).toBe(false);
    expect(reviewRuntimeIsDown(second)).toBe(true);
    expect(reviewPollIsOffline(second)).toBe(false);
    expect(reviewRuntimeCanWrite(second)).toBe(false);
    expect(
      agentConnectionForReviewPoll({
        health: second,
        lastKnownConnected: true,
        presenceIsFresh: false,
      }),
    ).toBe(true);
  });

  it("should report poll failure without reporting runtime unavailability", () => {
    const health = transition(["poll-failed", "poll-failed"]);

    expect(reviewPollIsOffline(health)).toBe(true);
    expect(reviewRuntimeIsDown(health)).toBe(false);
    expect(
      agentConnectionForReviewPoll({
        health,
        lastKnownConnected: true,
        presenceIsFresh: false,
      }),
    ).toBe(false);
  });

  it.each([
    ["poll-failed", "runtime-unavailable"],
    ["runtime-unavailable", "poll-failed"],
  ] as const)(
    "should restart the threshold when %s failures become %s failures",
    (firstResult, secondResult) => {
      const health = transition([firstResult, firstResult, secondResult]);

      expect(health).toEqual({
        state: secondResult,
        consecutiveFailures: 1,
      });
      expect(reviewPollIsOffline(health)).toBe(false);
      expect(reviewRuntimeIsDown(health)).toBe(false);
      expect(reviewRuntimeCanWrite(health)).toBe(true);
    },
  );

  it("should clear every failure state after a successful poll", () => {
    const health = transition([
      "runtime-unavailable",
      "runtime-unavailable",
      "success",
    ]);

    expect(health).toEqual(INITIAL_REVIEW_POLL_HEALTH);
    expect(reviewPollIsOffline(health)).toBe(false);
    expect(reviewRuntimeIsDown(health)).toBe(false);
    expect(reviewRuntimeCanWrite(health)).toBe(true);
  });
});
