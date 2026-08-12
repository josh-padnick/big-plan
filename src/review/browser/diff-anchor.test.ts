import { describe, expect, it } from "vitest";
import type {
  DiffLocation,
  DiffPlace,
  SnapshotDiff,
} from "../shared/review-wire.js";
import {
  candidateMatchesLiveText,
  lensAnchorCandidates,
  tourStartIndex,
} from "./diff-anchor.js";

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

  it("should carry the result snapshot's text when the id crosses a snapshot boundary", () => {
    expect(
      lensAnchorCandidates(location({ newBlockId: "approach/paragraph-1" }), {
        isSuperseded: true,
      }),
    ).toEqual([
      {
        blockId: "approach/paragraph-1",
        placement: "replace",
        expectedText: "now",
      },
    ]);
  });

  it("should leave same-snapshot candidates without a text expectation", () => {
    const candidates = lensAnchorCandidates(
      location({ newBlockId: "approach/paragraph-1" }),
      { isSuperseded: false },
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.expectedText).toBeUndefined();
  });
});

describe("candidateMatchesLiveText", () => {
  it("should report a drifted block when the live text no longer matches the recorded text", () => {
    expect(
      candidateMatchesLiveText({
        candidate: {
          blockId: "approach/paragraph-1",
          placement: "replace",
          expectedText: "The delivery gate runs automated checks.",
        },
        liveText: "A canary rollout guards every deploy.",
      }),
    ).toBe(false);
  });

  it("should trust a cross-snapshot block when only whitespace and case differ", () => {
    expect(
      candidateMatchesLiveText({
        candidate: {
          blockId: "approach/paragraph-1",
          placement: "replace",
          expectedText: "The delivery gate runs automated checks.",
        },
        liveText: "  The delivery\n  gate runs AUTOMATED checks.  ",
      }),
    ).toBe(true);
  });

  it("should trust a same-snapshot candidate even when the block was reworded", () => {
    // The id and the displayed document share a snapshot, so the id is proof
    // enough; the live text legitimately differs from the diff's old side.
    expect(
      candidateMatchesLiveText({
        candidate: { blockId: "approach/paragraph-1", placement: "replace" },
        liveText: "A freshly reworded paragraph the diff is about.",
      }),
    ).toBe(true);
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

describe("candidateMatchesLiveText across extractions", () => {
  it("should trust a block whose live reading runs its parts together", () => {
    // The recorded side comes from the compiled tree, which separates
    // block-level children; the live side is read from the DOM, which does
    // not. Same block, two spellings.
    expect(
      candidateMatchesLiveText({
        candidate: {
          blockId: "approach/quick-summary-1",
          placement: "replace",
          expectedText: "Quick summary\nWhy\nReview comments must survive.",
        },
        liveText: "Quick summaryWhyReview comments must survive.",
      }),
    ).toBe(true);
  });

  it("should still report drift when the letters themselves differ", () => {
    expect(
      candidateMatchesLiveText({
        candidate: {
          blockId: "approach/quick-summary-1",
          placement: "replace",
          expectedText: "Quick summary\nWhy\nReview comments must survive.",
        },
        liveText: "Quick summaryWhyA canary rollout guards every deploy.",
      }),
    ).toBe(false);
  });
});
