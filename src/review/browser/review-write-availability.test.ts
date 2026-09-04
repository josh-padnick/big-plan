// Proves the shared write-availability predicate distinguishes every reason a
// write cannot land, and that a blocked path can say why without guessing.

import { describe, expect, it } from "vitest";
import {
  INITIAL_REVIEW_POLL_HEALTH,
  type ReviewPollHealth,
} from "./review-poll-health.js";
import {
  reviewSessionReach,
  reviewWriteAvailability,
  reviewWriteBlock,
  reviewWriteBlockedStatus,
  reviewWritePathOutcome,
  reviewWritePathTitle,
  reviewWriteRefusal,
  type ReviewWritePath,
} from "./review-write-availability.js";

const HEALTHY = INITIAL_REVIEW_POLL_HEALTH;
const RUNTIME_DOWN = {
  state: "runtime-unavailable",
  consecutiveFailures: 2,
  firstFailureAtMs: 0,
} as const satisfies ReviewPollHealth;
// A runtime that answers every poll and refuses each one: a 401 on a re-minted
// token, or a session id the page was not served with (BIG-282).
const RUNTIME_REFUSING = {
  state: "poll-failed",
  consecutiveFailures: 2,
} as const satisfies ReviewPollHealth;

const availability = (
  overrides: Partial<Parameters<typeof reviewWriteAvailability>[0]> = {},
) =>
  reviewWriteAvailability({
    hasReviewSession: true,
    health: HEALTHY,
    writesStalledMs: undefined,
    authoritative: true,
    ...overrides,
  });

/** Every explicit mutation path BIG-121 put behind the shared predicate. */
const PATHS = [
  "submit-comment",
  "reply",
  "chat",
  "delete-comment",
  "revert-changes",
  "cancel-request",
  "review-mode",
  "attach-image",
] as const satisfies ReadonlyArray<ReviewWritePath>;

describe("review write availability", () => {
  it("should allow writes when the session is live, reachable, and accepting", () => {
    expect(availability()).toEqual({ state: "available" });
  });

  it("should block a plan opened without a review session", () => {
    expect(availability({ hasReviewSession: false })).toMatchObject({
      state: "unavailable",
      block: "no-review-session",
    });
  });

  it("should block a session a newer runtime replaced", () => {
    expect(availability({ authoritative: false })).toMatchObject({
      block: "session-replaced",
    });
  });

  it("should block an unreachable runtime", () => {
    expect(availability({ health: RUNTIME_DOWN })).toMatchObject({
      block: "runtime-offline",
    });
  });

  it("should block a runtime that refuses this tab, with a reload as the way back", () => {
    // Before this block the gate let the write through and the runtime refused
    // it with a 401 nobody rendered; the captain's Disconnect click (BIG-282).
    expect(availability({ health: RUNTIME_REFUSING })).toMatchObject({
      block: "session-refused",
      cause: "This tab's review session is out of date.",
      remedy: "Reload this page to reconnect. All comments are safe.",
      label: "Review session out of date",
    });
  });

  it("should still allow writes while a single refused poll is outstanding", () => {
    expect(
      availability({
        health: { state: "poll-failed", consecutiveFailures: 1 },
      }),
    ).toEqual({ state: "available" });
  });

  it("should block a reachable runtime that has stopped accepting changes", () => {
    expect(availability({ writesStalledMs: 30_001 })).toMatchObject({
      block: "writes-stalled",
    });
  });

  it("should still allow writes while a single poll failure is outstanding", () => {
    expect(
      availability({
        health: {
          state: "runtime-unavailable",
          consecutiveFailures: 1,
          firstFailureAtMs: 0,
        },
      }),
    ).toEqual({ state: "available" });
  });

  it("should report a missing session ahead of every other block", () => {
    expect(
      availability({
        hasReviewSession: false,
        authoritative: false,
        health: RUNTIME_DOWN,
        writesStalledMs: 30_001,
      }),
    ).toMatchObject({ block: "no-review-session" });
  });

  it("should report a replaced session ahead of unreachability", () => {
    expect(
      availability({ authoritative: false, health: RUNTIME_DOWN }),
    ).toMatchObject({ block: "session-replaced" });
  });

  it("should report an unreachable runtime as offline rather than stalled", () => {
    expect(
      availability({ health: RUNTIME_DOWN, writesStalledMs: 30_001 }),
    ).toMatchObject({ block: "runtime-offline" });
  });

  it("should treat an unknown authority as writable", () => {
    expect(availability({ authoritative: undefined })).toEqual({
      state: "available",
    });
  });

  it("should give every block a cause, a remedy, and a label", () => {
    for (const input of [
      { hasReviewSession: false },
      { authoritative: false },
      { health: RUNTIME_DOWN },
      { health: RUNTIME_REFUSING },
      { writesStalledMs: 30_001 },
    ]) {
      const block = reviewWriteBlock(availability(input));

      expect(block).toBeDefined();
      expect(block?.cause).not.toBe("");
      expect(block?.remedy).not.toBe("");
      expect(block?.label).not.toBe("");
    }
  });

  it("should report no block while writes are available", () => {
    expect(reviewWriteBlock(availability())).toBeUndefined();
  });

  it("should read the session from the gate so no surface calls it reachable while writes are refused", () => {
    // The card, the toolbar, the banner, and the thread strips all read this
    // one answer; each reading poll health its own way is how the card said
    // "Agent connected" under a lost-contact banner (BIG-264, BIG-282).
    expect(reviewSessionReach(availability())).toBe("reachable");
    expect(reviewSessionReach(availability({ health: RUNTIME_DOWN }))).toBe(
      "offline",
    );
    expect(reviewSessionReach(availability({ health: RUNTIME_REFUSING }))).toBe(
      "out-of-date",
    );
  });

  it("should leave the session reachable for blocks that have a surface of their own", () => {
    for (const input of [
      { hasReviewSession: false },
      { authoritative: false },
      { writesStalledMs: 30_001 },
    ]) {
      expect(reviewSessionReach(availability(input))).toBe("reachable");
    }
  });

  it("should title every path's notice with what did not happen", () => {
    for (const path of PATHS) {
      expect(reviewWritePathTitle(path)).toMatch(/not|unchanged/u);
    }
    expect(reviewWritePathTitle("disconnect-agent")).toBe(
      "Agent not disconnected",
    );
  });

  it("should keep the seam's paths and outcomes in step", () => {
    // Adding a mutation path without saying what a refusal leaves behind would
    // silently reuse another path's promise about the reviewer's input.
    for (const path of PATHS) {
      expect(reviewWritePathOutcome(path)).not.toBe("");
    }
    expect(new Set(PATHS.map(reviewWritePathOutcome)).size).toBe(PATHS.length);
  });

  it("should join the cause, the path's outcome, and the remedy", () => {
    const block = reviewWriteBlock(availability({ writesStalledMs: 30_001 }));

    expect(
      block === undefined
        ? ""
        : reviewWriteBlockedStatus({
            block,
            outcome: "Your reply is still in the box.",
          }),
    ).toBe(
      "The review session has stopped accepting changes. Your reply is still in the box. Restart the review runtime to continue.",
    );
  });
});

describe("review write refusal per mutation path", () => {
  it.each(PATHS)(
    "should let %s go ahead while writes are available",
    (path) => {
      expect(
        reviewWriteRefusal({ path, availability: availability() }),
      ).toBeUndefined();
    },
  );

  it.each(PATHS)(
    "should refuse %s with the stall's cause, outcome, and remedy",
    (path) => {
      const refusal = reviewWriteRefusal({
        path,
        availability: availability({ writesStalledMs: 30_001 }),
      });

      expect(refusal).toBe(
        `The review session has stopped accepting changes. ${reviewWritePathOutcome(path)} Restart the review runtime to continue.`,
      );
    },
  );

  it.each(PATHS)(
    "should refuse %s with the offline cause, outcome, and remedy",
    (path) => {
      const refusal = reviewWriteRefusal({
        path,
        availability: availability({ health: RUNTIME_DOWN }),
      });

      expect(refusal).toBe(
        `Review session unreachable. ${reviewWritePathOutcome(path)} Restart \`big-plan review\`, then open the new URL it prints. All comments are safe.`,
      );
    },
  );

  it.each(PATHS)("should refuse %s without a review session", (path) => {
    expect(
      reviewWriteRefusal({
        path,
        availability: availability({ hasReviewSession: false }),
      }),
    ).toContain("Start `big-plan review` to send changes.");
  });

  it.each(PATHS)("should refuse %s once a newer runtime took over", (path) => {
    expect(
      reviewWriteRefusal({
        path,
        availability: availability({ authoritative: false }),
      }),
    ).toContain("A newer review runtime replaced this session.");
  });
});
