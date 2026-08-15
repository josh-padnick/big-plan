// Proves the page reports only the observation it can defend - contact lost
// and the remembered deadline passed - and never infers why the runtime went
// away.

import { describe, expect, it } from "vitest";
import { reviewEndReason } from "./review-expiry.js";

const THIRTY_MINUTES_MS = 30 * 60 * 1_000;

describe("review end reason", () => {
  it("should report a passed deadline once the last known one is behind us", () => {
    // Polls stopped long enough that nothing pushed the deadline forward.
    expect(
      reviewEndReason({
        expiresAtMs: 1_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "deadline-passed" });
  });

  it("should report a passed deadline without claiming why the runtime went away", () => {
    // The limit this test documents: the runtime may have been stopped by
    // hand, or may still be running for another tab whose polls kept its real
    // deadline ahead of this one. The result carries no cause either way, so
    // no caller can render an explanation the page cannot defend.
    expect(
      reviewEndReason({
        expiresAtMs: 1_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 5_000_000,
      }),
    ).toEqual({ kind: "deadline-passed" });
  });

  it("should treat a deadline still ahead as an ordinary stopped runtime", () => {
    expect(
      reviewEndReason({
        expiresAtMs: 5_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "stopped" });
  });

  it("should report nothing extra when no deadline was ever published", () => {
    expect(
      reviewEndReason({
        expiresAtMs: undefined,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "stopped" });
  });

  it("should report nothing extra when the idle timeout is disabled", () => {
    // --idle-timeout 0 publishes no deadline, so a stale one cannot outlive it.
    expect(
      reviewEndReason({
        expiresAtMs: 1_000,
        idleTimeoutMs: 0,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "stopped" });
    expect(
      reviewEndReason({
        expiresAtMs: 1_000,
        idleTimeoutMs: undefined,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "stopped" });
  });

  it("should treat the deadline itself as reached, and one ms before it as not", () => {
    expect(
      reviewEndReason({
        expiresAtMs: 2_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "deadline-passed" });
    expect(
      reviewEndReason({
        expiresAtMs: 2_001,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "stopped" });
  });
});
