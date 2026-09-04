import { describe, expect, it } from "vitest";
import type {
  DiffLocation,
  DiffPlace,
  SnapshotDiff,
} from "../shared/review-wire.js";
import {
  candidateMatchesLiveKind,
  candidateMatchesLiveText,
  lensAnchorCandidates,
  tourStartIndex,
} from "./diff-anchor.js";

const location = (fields: Partial<DiffLocation>): DiffLocation => ({
  status: "changed",
  isComponentRoot: false,
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

  it("should stand a superseded removal beside its neighbours", () => {
    // A neighbour describes a revision the reader has moved past, so it is a
    // worse answer than the block itself - and a far better one than nowhere,
    // which used to mean a card at the foot of the document.
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
    ).toEqual([
      {
        blockId: "approach/paragraph-3",
        placement: "before",
        expectedKind: "paragraph",
      },
      {
        blockId: "approach/paragraph-1",
        placement: "after",
        expectedKind: "paragraph",
      },
    ]);
  });

  it("should hold superseded prose to its kind rather than its recorded text", () => {
    expect(
      lensAnchorCandidates(location({ newBlockId: "approach/paragraph-1" }), {
        isSuperseded: true,
      }),
    ).toEqual([
      {
        blockId: "approach/paragraph-1",
        placement: "replace",
        expectedKind: "paragraph",
      },
    ]);
  });

  it("should not hold superseded prose to a recorded picture either", () => {
    expect(
      lensAnchorCandidates(
        location({
          kind: "image",
          newBlockId: "approach/image-1",
          newPresentation: {
            aspect: "image",
            source: "./assets/after.png",
            alt: "Map",
          },
        }),
        { isSuperseded: true },
      ),
    ).toEqual([
      {
        blockId: "approach/image-1",
        placement: "replace",
        expectedKind: "image",
      },
    ]);
  });

  it("should hold a superseded component to the kind its id named", () => {
    // A structural path is not an identity. Without this the historical card
    // would stand over whatever component inherited the path, hiding a live
    // block behind a record of something else.
    const candidates = lensAnchorCandidates(
      location({
        kind: "data-table",
        isComponentRoot: true,
        newBlockId: "approach/data-table-1",
        view: "<div data-component-diff></div>",
      }),
      { isSuperseded: true },
    );
    expect(candidates[0]?.expectedKind).toBe("data-table");
    expect(
      candidateMatchesLiveKind({
        candidate: candidates[0] ?? { blockId: "", placement: "replace" },
        liveKind: "wireframe",
      }),
    ).toBe(false);
    expect(
      candidateMatchesLiveKind({
        candidate: candidates[0] ?? { blockId: "", placement: "replace" },
        liveKind: "data-table",
      }),
    ).toBe(true);
  });

  it("should hold a superseded component to its place rather than its old text", () => {
    // A location that brought its own rendering reads the live block for
    // nothing, so a text expectation could only exile a change the plan still
    // has a place for into the archive at the foot of the document.
    expect(
      lensAnchorCandidates(
        location({
          kind: "data-table",
          isComponentRoot: true,
          newBlockId: "approach/data-table-1",
          view: "<div data-component-diff></div>",
        }),
        { isSuperseded: true },
      ),
    ).toEqual([
      {
        blockId: "approach/data-table-1",
        placement: "replace",
        expectedKind: "data-table",
      },
    ]);
  });

  it("should not expect a picture identity from a superseded component view", () => {
    const candidates = lensAnchorCandidates(
      location({
        kind: "wireframe",
        isComponentRoot: true,
        newBlockId: "approach/wireframe-1",
        view: "<div data-component-diff></div>",
        newPresentation: {
          aspect: "image",
          source: "./assets/after.png",
          alt: "Map",
        },
      }),
      { isSuperseded: true },
    );
    expect(candidates[0]?.expectedPicture).toBeUndefined();
    expect(candidates[0]?.expectedText).toBeUndefined();
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

describe("candidateMatchesLiveKind", () => {
  it("should accept a component the plan revised again", () => {
    // The case the reader is meant to see in place: same component, new
    // content. Text equality would refuse this and exile the change.
    const candidates = lensAnchorCandidates(
      location({
        kind: "wireframe",
        isComponentRoot: true,
        newBlockId: "approach/wireframe-1",
        newText: "the words it used to hold",
        view: "<div data-component-diff></div>",
      }),
      { isSuperseded: true },
    );
    const candidate = candidates[0];
    expect(candidate?.expectedText).toBeUndefined();
    expect(
      candidateMatchesLiveKind({
        candidate: candidate ?? { blockId: "", placement: "replace" },
        liveKind: "wireframe",
      }),
    ).toBe(true);
  });

  it("should accept any live kind when the id shares the document's snapshot", () => {
    const candidates = lensAnchorCandidates(
      location({ newBlockId: "approach/paragraph-1" }),
      { isSuperseded: false },
    );
    expect(
      candidateMatchesLiveKind({
        candidate: candidates[0] ?? { blockId: "", placement: "replace" },
        liveKind: "anything",
      }),
    ).toBe(true);
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

  it("should trust a cross-snapshot block when only whitespace differs", () => {
    expect(
      candidateMatchesLiveText({
        candidate: {
          blockId: "approach/paragraph-1",
          placement: "replace",
          expectedText: "The delivery gate runs automated checks.",
        },
        liveText: "  The delivery\n  gate runs automated checks.  ",
      }),
    ).toBe(true);
  });

  it("should report drift when case or token boundaries differ", () => {
    const candidate = {
      blockId: "approach/paragraph-1",
      placement: "replace" as const,
      expectedText: "The rollback requires API approval.",
    };

    expect(
      candidateMatchesLiveText({
        candidate,
        liveText: "The rollback requires api approval.",
      }),
    ).toBe(false);
    expect(
      candidateMatchesLiveText({
        candidate: {
          ...candidate,
          expectedText: "The roll back requires API approval.",
        },
        liveText: "The rollback requires API approval.",
      }),
    ).toBe(false);
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
