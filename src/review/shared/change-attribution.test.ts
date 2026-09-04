// Proves per-comment change attribution stays separate from whole-diff truth.

import { describe, expect, it } from "vitest";
import type { SnapshotDiff } from "./review-wire.js";
import { attributeDiffPlaces } from "./change-attribution.js";

const diff: SnapshotDiff = {
  from: "a".repeat(16),
  to: "b".repeat(16),
  locations: [
    {
      status: "changed",
      scope: "section/one",
      oldBlockId: "section/one/paragraph-1",
      newBlockId: "section/one/paragraph-1",
      kind: "paragraph",
      label: "One",
      section: "One",
      oldText: "Was one",
      newText: "Now one",
      runs: [],
    },
    {
      status: "added",
      scope: "section/two",
      newBlockId: "section/two/paragraph-1",
      kind: "paragraph",
      label: "Two",
      section: "Two",
      oldText: "",
      newText: "Now two",
      runs: [],
    },
  ],
  places: [
    {
      placeId: "1".repeat(16),
      status: "changed",
      label: "One",
      section: "One",
      note: "reworded",
      locationIndexes: [0],
    },
    {
      placeId: "2".repeat(16),
      status: "added",
      label: "Two",
      section: "Two",
      note: "added",
      locationIndexes: [1],
      ownerChangeSetIds: ["beef"],
    },
  ],
};

describe("change attribution", () => {
  it("should expose owned places and disclose changes elsewhere", () => {
    expect(
      attributeDiffPlaces({
        diff,
        changeTargets: ["section/one/paragraph-1"],
        changeSetId: "cafe",
      }),
    ).toEqual({
      placeIds: ["1".repeat(16)],
      spilloverCount: 1,
      foreign: [{ changeSetId: "beef", placeCount: 1 }],
    });
  });

  it("should never report the attributed set as foreign to itself", () => {
    const owned: SnapshotDiff = {
      ...diff,
      places: diff.places.map((place) => ({
        ...place,
        ownerChangeSetIds: ["cafe"],
      })),
    };
    expect(
      attributeDiffPlaces({
        diff: owned,
        changeTargets: ["section/one/paragraph-1"],
        changeSetId: "cafe",
      }),
    ).toEqual({
      placeIds: ["1".repeat(16)],
      spilloverCount: 1,
      foreign: [],
    });
  });

  it("should exclude a targeted place when another change set owns it", () => {
    const foreignTarget: SnapshotDiff = {
      ...diff,
      places: [
        {
          ...diff.places[0],
          ownerChangeSetIds: ["beef"],
        },
      ],
    };
    expect(
      attributeDiffPlaces({
        diff: foreignTarget,
        changeTargets: ["section/one/paragraph-1"],
        changeSetId: "cafe",
      }),
    ).toEqual({
      placeIds: [],
      spilloverCount: 1,
      foreign: [{ changeSetId: "beef", placeCount: 1 }],
    });
  });
});
