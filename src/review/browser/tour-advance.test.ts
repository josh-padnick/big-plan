// Proves the one rule that moves the open stepper onto a newer round: it
// follows the thread that owns the tour, and nothing else - and that it keeps
// the reviewer on the change they were reading when it moves.

import { describe, expect, it } from "vitest";
import type {
  DiffLocation,
  DiffPlace,
  SnapshotDiff,
} from "../shared/review-wire.js";
import { advancedTourPlaceId, tourIsBehind } from "./tour-advance.js";

const S1 = "1".repeat(16);
const S2 = "2".repeat(16);
const S3 = "3".repeat(16);

const location = (fields: Partial<DiffLocation>): DiffLocation => ({
  status: "changed",
  scope: "section",
  kind: "paragraph",
  isComponentRoot: false,
  label: "Paragraph",
  section: "Approach",
  oldText: "",
  newText: "",
  runs: [],
  ...fields,
});

const place = (fields: Partial<DiffPlace>): DiffPlace => ({
  placeId: "place",
  status: "changed",
  label: "Paragraph",
  section: "Approach",
  note: "reworded",
  locationIndexes: [0],
  ...fields,
});

/** One round of a set: each place speaks for the block named beside it. */
const round = (
  to: string,
  entries: ReadonlyArray<{
    readonly placeId: string;
    readonly blockId: string;
    readonly side?: "old" | "new";
  }>,
): SnapshotDiff => ({
  from: S1,
  to,
  locations: entries.map((entry) =>
    location(
      entry.side === "old"
        ? { status: "removed", oldBlockId: entry.blockId }
        : { newBlockId: entry.blockId },
    ),
  ),
  places: entries.map((entry, index) =>
    place({ placeId: entry.placeId, locationIndexes: [index] }),
  ),
});

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

describe("advancedTourPlaceId", () => {
  const before = round(S2, [
    { placeId: "a-1", blockId: "section/approach/paragraph-1" },
    { placeId: "b-1", blockId: "section/approach/paragraph-2" },
  ]);

  it("stays on the change the reviewer was reading, renamed by the round", () => {
    const after = round(S3, [
      { placeId: "a-2", blockId: "section/approach/paragraph-1" },
      { placeId: "b-2", blockId: "section/approach/paragraph-2" },
    ]);
    expect(
      advancedTourPlaceId({
        activeDiff: before,
        activePlaceId: "b-1",
        diff: after,
        placeIds: ["a-2", "b-2"],
      }),
    ).toBe("b-2");
  });

  it("knows the block whichever side of the change names it", () => {
    expect(
      advancedTourPlaceId({
        activeDiff: before,
        activePlaceId: "b-1",
        diff: round(S3, [
          { placeId: "a-2", blockId: "section/approach/paragraph-1" },
          {
            placeId: "b-2",
            blockId: "section/approach/paragraph-2",
            side: "old",
          },
        ]),
        placeIds: ["a-2", "b-2"],
      }),
    ).toBe("b-2");
  });

  it("names nothing when the round withdrew the change being read", () => {
    expect(
      advancedTourPlaceId({
        activeDiff: before,
        activePlaceId: "b-1",
        diff: round(S3, [
          { placeId: "a-2", blockId: "section/approach/paragraph-1" },
        ]),
        placeIds: ["a-2"],
      }),
    ).toBeUndefined();
  });

  it("names nothing before the tour has landed anywhere", () => {
    const after = round(S3, [
      { placeId: "a-2", blockId: "section/approach/paragraph-1" },
    ]);
    expect(
      advancedTourPlaceId({
        activeDiff: null,
        activePlaceId: "b-1",
        diff: after,
        placeIds: ["a-2"],
      }),
    ).toBeUndefined();
    expect(
      advancedTourPlaceId({
        activeDiff: before,
        activePlaceId: null,
        diff: after,
        placeIds: ["a-2"],
      }),
    ).toBeUndefined();
  });

  it("ignores a successor the tour is not allowed to walk", () => {
    expect(
      advancedTourPlaceId({
        activeDiff: before,
        activePlaceId: "b-1",
        diff: round(S3, [
          { placeId: "a-2", blockId: "section/approach/paragraph-1" },
          { placeId: "b-2", blockId: "section/approach/paragraph-2" },
        ]),
        placeIds: ["a-2"],
      }),
    ).toBeUndefined();
  });
});
