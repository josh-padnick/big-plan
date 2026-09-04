// Proves a destructive review dialog shows the content it deletes, grouped by
// the slide it sits on, and previews that content without inventing a
// vocabulary for it.

import { describe, expect, it } from "vitest";
import type { DiffLocation, DiffPlace, SnapshotDiff } from "./review-wire.js";
import {
  boundPreviewText,
  EXCERPT_LIMIT,
  projectPlanLoss,
  planLossChangeCount,
} from "./plan-loss.js";

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
  section = "One",
): DiffPlace => ({
  placeId,
  status: "changed",
  label: "One",
  section,
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

describe("boundPreviewText", () => {
  it("collapses whitespace and leaves short text whole", () => {
    expect(boundPreviewText("  a\n  b  ")).toEqual({
      text: "a b",
      isExcerpt: false,
    });
  });

  it("cuts at a word boundary and marks the excerpt", () => {
    const bounded = boundPreviewText("alpha beta gamma delta", 12);
    expect(bounded).toEqual({ text: "alpha beta…", isExcerpt: true });
  });

  it("cuts mid-word rather than throwing away most of the bound", () => {
    const bounded = boundPreviewText("a supercalifragilistic word", 12);
    expect(bounded.text).toBe("a supercalif…");
    expect(bounded.isExcerpt).toBe(true);
  });

  it("defaults to the excerpt limit", () => {
    const bounded = boundPreviewText("x".repeat(EXCERPT_LIMIT + 10));
    expect(bounded.isExcerpt).toBe(true);
    expect(bounded.text.length).toBe(EXCERPT_LIMIT + 1);
  });
});

describe("projectPlanLoss", () => {
  it("groups the content it deletes by the slide it sits on", () => {
    const slides = projectPlanLoss({
      diff: diffOf(
        [
          location({ kind: "paragraph", newText: "One changed." }),
          location({
            kind: "paragraph",
            scope: "section/two",
            newBlockId: "section/two/paragraph-1",
            newText: "Two changed.",
          }),
        ],
        [place("p1", [0], "One"), place("p2", [1], "Two")],
      ),
    });
    expect(slides.map((slide) => slide.scope)).toEqual([
      "section/one",
      "section/two",
    ]);
    expect(slides.map((slide) => slide.title)).toEqual(["One", "Two"]);
    expect(planLossChangeCount(slides)).toBe(2);
  });

  it("counts every place on one slide as that slide's changes", () => {
    const slides = projectPlanLoss({
      diff: diffOf(
        [
          location({ kind: "paragraph", newText: "First." }),
          location({
            kind: "list",
            newBlockId: "section/one/list-1",
            newText: "Second.",
          }),
        ],
        [place("p1", [0]), place("p2", [1])],
      ),
    });
    expect(slides).toHaveLength(1);
    expect(slides[0]?.changeCount).toBe(2);
    expect(slides[0]?.previews).toHaveLength(2);
  });

  it("previews a picture as an image and everything else as its words", () => {
    const slides = projectPlanLoss({
      diff: diffOf(
        [
          location({
            kind: "paragraph",
            newPresentation: { aspect: "image", source: "a.png", alt: "A" },
          }),
          location({
            kind: "paragraph",
            newBlockId: "section/one/paragraph-2",
            newText: "The words that go.",
          }),
        ],
        [place("p1", [0, 1])],
      ),
    });
    expect(slides[0]?.previews).toEqual([
      { shape: "image", image: { source: "a.png", alt: "A" } },
      {
        shape: "text",
        excerpt: { text: "The words that go.", isExcerpt: false },
      },
    ]);
  });

  it("shows one passage once when a component names it twice", () => {
    const slides = projectPlanLoss({
      diff: diffOf(
        [
          location({
            kind: "decision",
            isComponentRoot: true,
            newText: "Same words.",
          }),
          location({
            kind: "decision",
            newBlockId: "section/one/decision-1",
            ownerId: "section/one/decision-1",
            newText: "Same words.",
          }),
        ],
        [place("p1", [0, 1])],
      ),
    });
    expect(slides[0]?.previews).toEqual([
      { shape: "text", excerpt: { text: "Same words.", isExcerpt: false } },
    ]);
  });

  it("says nothing for a block the rejection brings back rather than deletes", () => {
    const slides = projectPlanLoss({
      diff: diffOf(
        [
          location({
            kind: "paragraph",
            status: "removed",
            oldText: "Came back.",
            newText: "",
          }),
        ],
        [place("p1", [0])],
      ),
    });
    expect(slides[0]?.previews).toEqual([]);
    expect(slides[0]?.changeCount).toBe(1);
  });

  it("does not preview a picture that rejection brings back", () => {
    const slides = projectPlanLoss({
      diff: diffOf(
        [
          location({
            kind: "image",
            status: "removed",
            oldPresentation: {
              aspect: "image",
              source: "restored.png",
              alt: "Restored picture",
            },
          }),
        ],
        [place("p1", [0])],
      ),
    });
    expect(slides[0]?.previews).toEqual([]);
    expect(slides[0]?.changeCount).toBe(1);
  });

  it("keeps only the slides the named places sit on", () => {
    const slides = projectPlanLoss({
      diff: diffOf(
        [
          location({ kind: "paragraph", newBlockId: "section/one/mine" }),
          location({
            kind: "paragraph",
            scope: "section/two",
            newBlockId: "section/two/theirs",
          }),
        ],
        [place("mine", [0], "One"), place("theirs", [1], "Two")],
      ),
      placeIds: ["mine"],
    });
    expect(slides.map((slide) => slide.scope)).toEqual(["section/one"]);
  });

  it("says nothing is going when no place is named", () => {
    const slides = projectPlanLoss({
      diff: diffOf([location({ kind: "paragraph" })], [place("p1", [0])]),
      placeIds: [],
    });
    expect(slides).toEqual([]);
  });

  it("projects the whole revision when the caller narrows by nothing", () => {
    const slides = projectPlanLoss({
      diff: diffOf([location({ kind: "paragraph" })], [place("p1", [0])]),
    });
    expect(slides.map((slide) => slide.scope)).toEqual(["section/one"]);
  });

  it("carries a block id so the dialog can find the live slide", () => {
    const slides = projectPlanLoss({
      diff: diffOf([location({ kind: "paragraph" })], [place("p1", [0])]),
    });
    expect(slides[0]?.anchorBlockId).toBe("section/one/paragraph-1");
  });
});
