// Proves a page that lost contact distinguishes a passed remembered deadline
// from an unexplained outage without inferring the runtime's current state.

import { describe, expect, it } from "vitest";
import {
  reviewContactLossObservation,
  reviewContactLossRecovery,
} from "./review-expiry.js";

const THIRTY_MINUTES_MS = 30 * 60 * 1_000;

describe("review contact loss observation", () => {
  it("should report when the last known deadline passed", () => {
    expect(
      reviewContactLossObservation({
        expiresAtMs: 1_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "deadline-passed" });
  });

  it("should not infer the runtime state from a passed remembered deadline", () => {
    expect(
      reviewContactLossObservation({
        expiresAtMs: 30_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 45_000,
      }),
    ).toEqual({ kind: "deadline-passed" });
  });

  it("should remain unexplained when the deadline is still in the future", () => {
    expect(
      reviewContactLossObservation({
        expiresAtMs: 5_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "unexplained" });
  });

  it("should remain unexplained when no deadline was ever published", () => {
    expect(
      reviewContactLossObservation({
        expiresAtMs: undefined,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "unexplained" });
  });

  it("should remain unexplained when the idle timeout is disabled", () => {
    expect(
      reviewContactLossObservation({
        expiresAtMs: 1_000,
        idleTimeoutMs: 0,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "unexplained" });
    expect(
      reviewContactLossObservation({
        expiresAtMs: 1_000,
        idleTimeoutMs: undefined,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "unexplained" });
  });

  it("should report the exact deadline as passed but not one ms before it", () => {
    expect(
      reviewContactLossObservation({
        expiresAtMs: 2_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "deadline-passed" });
    expect(
      reviewContactLossObservation({
        expiresAtMs: 2_001,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "unexplained" });
  });
});

describe("review contact loss recovery", () => {
  it("should prefer the replacement address over a restart command", () => {
    expect(
      reviewContactLossRecovery({
        observation: { kind: "deadline-passed" },
        latestReviewUrl: "http://127.0.0.1:4321/review",
        restartCommand: "node big-plan.mjs review plan.mdx",
      }),
    ).toEqual({
      kind: "replacement",
      href: "http://127.0.0.1:4321/review",
    });
  });

  it("should use the restart command when no replacement is recorded", () => {
    expect(
      reviewContactLossRecovery({
        observation: { kind: "deadline-passed" },
        latestReviewUrl: undefined,
        restartCommand: "node big-plan.mjs review plan.mdx",
      }),
    ).toEqual({
      kind: "restart-command",
      command: "node big-plan.mjs review plan.mdx",
    });
  });

  it("should report when neither recovery destination is known", () => {
    expect(
      reviewContactLossRecovery({
        observation: { kind: "deadline-passed" },
        latestReviewUrl: undefined,
        restartCommand: undefined,
      }),
    ).toEqual({ kind: "no-restart-command" });
  });

  it("should leave unexplained contact loss to transient recovery", () => {
    expect(
      reviewContactLossRecovery({
        observation: { kind: "unexplained" },
        latestReviewUrl: "http://127.0.0.1:4321/review",
        restartCommand: "node big-plan.mjs review plan.mdx",
      }),
    ).toBeUndefined();
  });
});
