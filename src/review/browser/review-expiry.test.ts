// Proves an unreachable page distinguishes a passed remembered deadline from
// an unexplained outage without treating that observation as a cause.

import { describe, expect, it } from "vitest";
import { reviewEndObservation } from "./review-expiry.js";

const THIRTY_MINUTES_MS = 30 * 60 * 1_000;

describe("review end observation", () => {
  it("should report when the last known deadline passed", () => {
    expect(
      reviewEndObservation({
        expiresAtMs: 1_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "deadline-passed" });
  });

  it("should not infer why the runtime stopped from a passed remembered deadline", () => {
    expect(
      reviewEndObservation({
        expiresAtMs: 30_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 45_000,
      }),
    ).toEqual({ kind: "deadline-passed" });
  });

  it("should remain unexplained when the deadline is still in the future", () => {
    expect(
      reviewEndObservation({
        expiresAtMs: 5_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "unexplained" });
  });

  it("should remain unexplained when no deadline was ever published", () => {
    expect(
      reviewEndObservation({
        expiresAtMs: undefined,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "unexplained" });
  });

  it("should remain unexplained when the idle timeout is disabled", () => {
    expect(
      reviewEndObservation({
        expiresAtMs: 1_000,
        idleTimeoutMs: 0,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "unexplained" });
    expect(
      reviewEndObservation({
        expiresAtMs: 1_000,
        idleTimeoutMs: undefined,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "unexplained" });
  });

  it("should report the exact deadline as passed but not one ms before it", () => {
    expect(
      reviewEndObservation({
        expiresAtMs: 2_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "deadline-passed" });
    expect(
      reviewEndObservation({
        expiresAtMs: 2_001,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "unexplained" });
  });
});
