// Proves the page only claims an idle expiry it can actually prove from the
// deadline it was last told, and otherwise stays with the honest generic
// wording rather than guessing.

import { describe, expect, it } from "vitest";
import { reviewEndReason } from "./review-expiry.js";

const THIRTY_MINUTES_MS = 30 * 60 * 1_000;

describe("review end reason", () => {
  it("should name an idle expiry once the last known deadline has passed", () => {
    // The tab was suspended past the deadline: polls stopped, so nothing
    // pushed it forward, and the runtime closed itself while nobody looked.
    expect(
      reviewEndReason({
        expiresAtMs: 1_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "expired", idleTimeoutMs: THIRTY_MINUTES_MS });
  });

  it("should treat a deadline still in the future as a stopped runtime", () => {
    // Polls were landing right up to the silence, so the session had plenty of
    // life left: somebody stopped the runtime, and claiming expiry would lie.
    expect(
      reviewEndReason({
        expiresAtMs: 5_000,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "stopped" });
  });

  it("should not claim expiry when no deadline was ever published", () => {
    expect(
      reviewEndReason({
        expiresAtMs: undefined,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "stopped" });
  });

  it("should not claim expiry when the idle timeout is disabled", () => {
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
    ).toEqual({ kind: "expired", idleTimeoutMs: THIRTY_MINUTES_MS });
    expect(
      reviewEndReason({
        expiresAtMs: 2_001,
        idleTimeoutMs: THIRTY_MINUTES_MS,
        nowMs: 2_000,
      }),
    ).toEqual({ kind: "stopped" });
  });
});
