// Proves the revert dialog names the content it deletes by kind, and falls
// back to the generic name only when the diff genuinely offers no kind.

import { describe, expect, it } from "vitest";
import type { DiffLocation, DiffPlace, SnapshotDiff } from "./review-wire.js";
import {
  projectRevertLoss,
  REVERT_CONTENT_KIND_GENERIC,
  startSentence,
} from "./revert-copy.js";

const location = (
  overrides: Partial<DiffLocation> & { readonly kind: string },
): DiffLocation => ({
  status: "changed",
  scope: "section/one",
  newBlockId: `section/one/${overrides.kind}-1`,
  isComponentRoot: false,
  label: "One",
  section: "One",
  oldText: "Was",
  newText: "Now",
  runs: [],
  ...overrides,
});

const place = (
  placeId: string,
  locationIndexes: ReadonlyArray<number>,
): DiffPlace => ({
  placeId,
  status: "changed",
  label: "One",
  section: "One",
  note: "reworded",
  locationIndexes,
});

const diffOf = (
  locations: ReadonlyArray<DiffLocation>,
  places: ReadonlyArray<DiffPlace>,
): SnapshotDiff => ({
  from: "a".repeat(16),
  to: "b".repeat(16),
  locations,
  places,
});

describe("projectRevertLoss", () => {
  it("names one changed block as a thing rather than a count", () => {
    const loss = projectRevertLoss({
      diff: diffOf([location({ kind: "paragraph" })], [place("p1", [0])]),
    });
    expect(loss.lost).toBe("a paragraph of generated text");
    expect(loss.isConcrete).toBe(true);
  });

  it("counts repeated kinds and joins several kinds readably", () => {
    const loss = projectRevertLoss({
      diff: diffOf(
        [
          location({ kind: "paragraph" }),
          location({ kind: "paragraph" }),
          location({ kind: "list" }),
        ],
        [place("p1", [0, 1, 2])],
      ),
    });
    expect(loss.lost).toBe(
      "2 paragraphs of generated text and a generated list",
    );
  });

  it("calls a picture an image even though its block is a paragraph", () => {
    const loss = projectRevertLoss({
      diff: diffOf(
        [
          location({
            kind: "paragraph",
            newPresentation: { aspect: "image", source: "a.png", alt: "A" },
          }),
        ],
        [place("p1", [0])],
      ),
    });
    expect(loss.lost).toBe("a generated image");
  });

  it("names a component root by the component it is", () => {
    const loss = projectRevertLoss({
      diff: diffOf(
        [location({ kind: "quick-summary", isComponentRoot: true })],
        [place("p1", [0])],
      ),
    });
    expect(loss.lost).toBe("a generated quick summary block");
  });

  it("keeps only the places the outcome's change targets own", () => {
    const loss = projectRevertLoss({
      diff: diffOf(
        [
          location({ kind: "paragraph", newBlockId: "section/one/mine" }),
          location({ kind: "list", newBlockId: "section/one/theirs" }),
        ],
        [place("mine", [0]), place("theirs", [1])],
      ),
      changeTargets: ["section/one/mine"],
    });
    expect(loss.places.map((entry) => entry.placeId)).toEqual(["mine"]);
    expect(loss.lost).toBe("a paragraph of generated text");
  });

  it("keeps the whole diff when attribution matches nothing", () => {
    const loss = projectRevertLoss({
      diff: diffOf([location({ kind: "paragraph" })], [place("p1", [0])]),
      changeTargets: ["section/elsewhere/paragraph-1"],
    });
    expect(loss.places.map((entry) => entry.placeId)).toEqual(["p1"]);
  });

  it("falls back to the generic name when no kind is recognizable", () => {
    const loss = projectRevertLoss({
      diff: diffOf([location({ kind: "thematic-break" })], [place("p1", [0])]),
    });
    expect(loss.lost).toBe(REVERT_CONTENT_KIND_GENERIC);
    expect(loss.isConcrete).toBe(false);
  });
});

describe("startSentence", () => {
  it("capitalizes a phrase written to sit mid-sentence", () => {
    expect(startSentence("a generated image")).toBe("A generated image");
  });

  it("leaves an empty phrase alone", () => {
    expect(startSentence("")).toBe("");
  });
});
