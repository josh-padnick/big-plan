// Proves a page that lost contact distinguishes a passed remembered deadline
// from an unexplained outage without inferring the runtime's current state.

import { describe, expect, it } from "vitest";
import { reviewContactLossObservation } from "./review-expiry.js";

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
