import { describe, expect, it } from "vitest";
import type {
  DiffLocation,
  DiffPlace,
  SnapshotDiff,
} from "../shared/review-wire.js";
import { lensAnchorCandidates, tourStartIndex } from "./diff-anchor.js";

const location = (fields: Partial<DiffLocation>): DiffLocation => ({
  status: "changed",
  scope: "section/approach",
  kind: "paragraph",
  label: "Approach",
  section: "Approach",
  oldText: "was",
  newText: "now",
  runs: [],
  ...fields,
});

const place = (placeId: string): DiffPlace => ({
  placeId,
  status: "changed",
  label: placeId,
  section: "Approach",
  note: "reworded",
  locationIndexes: [0],
});

const diff = (placeIds: ReadonlyArray<string>): SnapshotDiff => ({
  from: "premise",
  to: "result",
  locations: [],
  places: placeIds.map(place),
});

describe("lensAnchorCandidates", () => {
  it("should replace a block that still exists in the current plan", () => {
    expect(
      lensAnchorCandidates(location({ newBlockId: "approach/paragraph-1" }), {
        isSuperseded: false,
      }),
    ).toEqual([{ blockId: "approach/paragraph-1", placement: "replace" }]);
  });

  it("should keep a removed block on the side of the neighbour it sat on", () => {
    expect(
      lensAnchorCandidates(
        location({
          status: "removed",
          oldBlockId: "approach/paragraph-2",
          beforeBlockId: "approach/paragraph-3",
          afterBlockId: "approach/paragraph-1",
        }),
        { isSuperseded: false },
      ),
    ).toEqual([
      { blockId: "approach/paragraph-3", placement: "before" },
      { blockId: "approach/paragraph-1", placement: "after" },
    ]);
  });

  it("should fall back to the preceding neighbour when nothing follows", () => {
    expect(
      lensAnchorCandidates(
        location({
          status: "removed",
          oldBlockId: "approach/paragraph-2",
          afterBlockId: "approach/paragraph-1",
        }),
        { isSuperseded: false },
      ),
    ).toEqual([{ blockId: "approach/paragraph-1", placement: "after" }]);
  });

  it("should refuse neighbour anchors once the plan moved past the change", () => {
    expect(
      lensAnchorCandidates(
        location({
          status: "removed",
          oldBlockId: "approach/paragraph-2",
          beforeBlockId: "approach/paragraph-3",
          afterBlockId: "approach/paragraph-1",
        }),
        { isSuperseded: true },
      ),
    ).toEqual([]);
  });
});

describe("tourStartIndex", () => {
  it("should open at the start when the caller names no place", () => {
    expect(
      tourStartIndex({
        diff: diff(["one", "two", "three"]),
        placeIds: ["one", "two", "three"],
      }),
    ).toBe(0);
  });

  it("should resolve the requested place in the diff's own order", () => {
    expect(
      tourStartIndex({
        diff: diff(["one", "two", "three"]),
        placeIds: ["three", "one"],
        startPlaceId: "three",
      }),
    ).toBe(1);
  });

  it("should open at the start when the requested place is gone", () => {
    expect(
      tourStartIndex({
        diff: diff(["one", "two"]),
        placeIds: ["one", "two"],
        startPlaceId: "removed-in-a-later-revision",
      }),
    ).toBe(0);
  });
});
