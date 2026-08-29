// Proves the one rule that moves the open stepper onto a newer round: it
// follows the thread that owns the tour, and nothing else.

import { describe, expect, it } from "vitest";
import { tourIsBehind } from "./tour-advance.js";

const S1 = "1".repeat(16);
const S2 = "2".repeat(16);
const S3 = "3".repeat(16);

describe("tourIsBehind", () => {
  it("is behind once its own thread committed a later round", () => {
    expect(
      tourIsBehind({
        activeChangeSetId: "c0de",
        activeDiff: { from: S1, to: S2 },
        changeSetId: "c0de",
        diff: { from: S1, to: S3 },
      }),
    ).toBe(true);
  });

  it("is current while the thread's bounds still match", () => {
    expect(
      tourIsBehind({
        activeChangeSetId: "c0de",
        activeDiff: { from: S1, to: S3 },
        changeSetId: "c0de",
        diff: { from: S1, to: S3 },
      }),
    ).toBe(false);
  });

  it("leaves another thread's tour alone, baseline shared or not", () => {
    expect(
      tourIsBehind({
        activeChangeSetId: "d1ce",
        activeDiff: { from: S1, to: S2 },
        changeSetId: "c0de",
        diff: { from: S1, to: S3 },
      }),
    ).toBe(false);
  });

  it("stays out of a tour no thread owns", () => {
    expect(
      tourIsBehind({
        activeChangeSetId: null,
        activeDiff: { from: S1, to: S2 },
        changeSetId: "c0de",
        diff: { from: S1, to: S3 },
      }),
    ).toBe(false);
    expect(
      tourIsBehind({
        activeChangeSetId: "c0de",
        activeDiff: { from: S1, to: S2 },
        changeSetId: undefined,
        diff: { from: S1, to: S3 },
      }),
    ).toBe(false);
  });

  it("waits for a diff at both ends before moving anyone", () => {
    expect(
      tourIsBehind({
        activeChangeSetId: "c0de",
        activeDiff: null,
        changeSetId: "c0de",
        diff: { from: S1, to: S3 },
      }),
    ).toBe(false);
    expect(
      tourIsBehind({
        activeChangeSetId: "c0de",
        activeDiff: { from: S1, to: S2 },
        changeSetId: "c0de",
        diff: null,
      }),
    ).toBe(false);
  });
});
