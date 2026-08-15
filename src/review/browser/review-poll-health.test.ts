// Proves the review poll-health transition keeps runtime availability separate
// from other poll failures and heals after a successful poll.

import { describe, expect, it } from "vitest";
import { deriveCurrentAgentActivity } from "../shared/agent-status.js";
import {
  agentProjectionForReviewPoll,
  INITIAL_REVIEW_POLL_HEALTH,
  reviewPollIsOffline,
  reviewRuntimeAcceptsWrites,
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
    const projection = agentProjectionForReviewPoll({
      health: second,
      hasObservedAgentSnapshot: true,
      lastObservableAtMs: 1_000,
      nowMs: 1_000_000,
    });
    expect(projection).toEqual({ state: "observable", nowMs: 1_000 });
    expect(
      deriveCurrentAgentActivity({
        requests: [],
        cancelPendingRequestIds: new Set(),
        progressEvents: [],
        agentConnected: true,
        runtimeOffline: false,
        now: projection.nowMs,
        heartbeatAt: 1_000,
      }),
    ).toMatchObject({ state: "idle", headline: "Agent connected" });
  });

  it("should report poll failure without reporting runtime unavailability", () => {
    const health = transition(["poll-failed", "poll-failed"]);

    expect(reviewPollIsOffline(health)).toBe(true);
    expect(reviewRuntimeIsDown(health)).toBe(false);
    expect(
      agentProjectionForReviewPoll({
        health,
        hasObservedAgentSnapshot: true,
        lastObservableAtMs: 1_000,
        nowMs: 1_000_000,
      }),
    ).toEqual({ state: "observable", nowMs: 1_000_000 });
  });

  it("should keep agent presence unobservable before the first snapshot", () => {
    const health = transition(["runtime-unavailable", "runtime-unavailable"]);

    expect(
      agentProjectionForReviewPoll({
        health,
        hasObservedAgentSnapshot: false,
        lastObservableAtMs: 1_000,
        nowMs: 1_000_000,
      }),
    ).toEqual({ state: "unobservable", nowMs: 1_000 });
  });

  it("should leave loading after repeated poll failures", () => {
    const health = transition(["poll-failed", "poll-failed"]);

    expect(
      agentProjectionForReviewPoll({
        health,
        hasObservedAgentSnapshot: false,
        lastObservableAtMs: 1_000,
        nowMs: 1_000_000,
      }),
    ).toEqual({ state: "agent-unavailable", nowMs: 1_000_000 });
  });

  it.each([
    INITIAL_REVIEW_POLL_HEALTH,
    transition(["runtime-unavailable"]),
    transition(["poll-failed"]),
  ])("should preserve initial loading while poll health is %o", (health) => {
    expect(
      agentProjectionForReviewPoll({
        health,
        hasObservedAgentSnapshot: false,
        lastObservableAtMs: 1_000,
        nowMs: 1_000_000,
      }),
    ).toEqual({ state: "loading", nowMs: 1_000_000 });
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

describe("review runtime write acceptance", () => {
  it("should accept writes while the runtime is reachable and reports no stall", () => {
    expect(
      reviewRuntimeAcceptsWrites({
        health: INITIAL_REVIEW_POLL_HEALTH,
        writesStalledMs: undefined,
      }),
    ).toBe(true);
  });

  it("should refuse writes to a reachable runtime that reports a stall", () => {
    // The whole point: every polled read still succeeds here, so reachability
    // alone would keep the page sending changes that cannot be saved.
    const healthy = INITIAL_REVIEW_POLL_HEALTH;
    expect(reviewRuntimeCanWrite(healthy)).toBe(true);
    expect(
      reviewRuntimeAcceptsWrites({ health: healthy, writesStalledMs: 30_001 }),
    ).toBe(false);
  });

  it("should refuse writes to an unreachable runtime whatever it last reported", () => {
    const down = transition(["runtime-unavailable", "runtime-unavailable"]);

    for (const writesStalledMs of [undefined, 30_001]) {
      expect(
        reviewRuntimeAcceptsWrites({ health: down, writesStalledMs }),
      ).toBe(false);
    }
  });
});
