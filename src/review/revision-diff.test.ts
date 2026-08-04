// Exercises the revision-diff seam directly so block attribution stays honest
// when structural ids shift and the viewer asks for old/new word runs.

import { describe, expect, it } from "vitest";
import {
  bandText,
  diffKindShowsComment,
  diffPresentationMode,
  diffRevisions,
  diffRunSimilarity,
  diffWords,
} from "./revision-diff.js";

const block = ({
  id,
  text,
  kind = "paragraph",
}: {
  readonly id: string;
  readonly text: string;
  readonly kind?: string;
}) => ({
  id,
  kind,
  label: text,
  section: "Approach",
  text,
});

describe("revision word diff", () => {
  it("should flow table cells inside a diff band without changing prose", () => {
    expect(
      bandText({
        location: {
          kind: "table-row",
          oldText: "\ntimeout\n504\n\ntransient\n",
          newText: "",
        },
        side: "old",
      }),
    ).toBe("timeout · 504 · transient");
    expect(
      bandText({
        location: {
          kind: "table",
          oldText: "",
          newText: "\nfield\n\nmeaning\n",
        },
        side: "new",
      }),
    ).toBe("field · meaning");
    expect(
      bandText({
        location: {
          kind: "paragraph",
          oldText: "First line.\nSecond line.",
          newText: "",
        },
        side: "old",
      }),
    ).toBe("First line.\nSecond line.");
    expect(diffKindShowsComment("paragraph")).toBe(true);
    expect(diffKindShowsComment("code")).toBe(false);
    expect(diffKindShowsComment("code-diff")).toBe(false);
    expect(diffKindShowsComment("table-row")).toBe(false);
  });

  it("should preserve unchanged words around a replacement", () => {
    expect(
      diffWords({
        before: "Keep the first version.",
        after: "Keep the stable version.",
      }),
    ).toEqual([
      { op: "same", text: "Keep the " },
      { op: "del", text: "first" },
      { op: "ins", text: "stable" },
      { op: "same", text: " version." },
    ]);
  });

  it("should identify a wholesale rewrite below the presentation threshold", () => {
    expect(
      diffRunSimilarity(
        diffWords({
          before: "Retry every request with exponential backoff.",
          after: "Queue failed operations for a bounded manual replay window.",
        }),
      ),
    ).toBeLessThan(0.2);
  });

  it("should preserve word-level presentation for a focused rewrite", () => {
    expect(
      diffRunSimilarity(
        diffWords({
          before: "Keep the first version.",
          after: "Keep the stable version.",
        }),
      ),
    ).toBeGreaterThan(0.2);
  });

  it("should use separate before and after bands for a substantial rewrite", () => {
    expect(
      diffPresentationMode(
        diffWords({
          before: "Retries use an exponential delay after every failure.",
          after: "Operators replay bounded queues during the recovery window.",
        }),
      ),
    ).toBe("bands");
    expect(
      diffPresentationMode(
        diffWords({
          before: "Keep the first version.",
          after: "Keep the stable version.",
        }),
      ),
    ).toBe("inline");
  });

  it("should treat two empty revisions as identical", () => {
    expect(diffRunSimilarity([])).toBe(1);
  });
});

describe("revision block alignment", () => {
  it("should treat an inserted sibling as added without shifting later identities", () => {
    const before = [
      block({ id: "section/approach/paragraph-1", text: "First." }),
      block({ id: "section/approach/paragraph-2", text: "Second." }),
    ];
    const after = [
      block({ id: "section/approach/paragraph-1", text: "Inserted." }),
      block({ id: "section/approach/paragraph-2", text: "First." }),
      block({ id: "section/approach/paragraph-3", text: "Second." }),
    ];

    expect(diffRevisions({ before, after })).toEqual([
      expect.objectContaining({
        status: "added",
        newBlockId: "section/approach/paragraph-1",
        newText: "Inserted.",
      }),
    ]);
  });

  it("should report a rewrite, addition, and removal in presentation order", () => {
    const before = [
      block({ id: "section/approach/paragraph-1", text: "Old wording." }),
      block({
        id: "section/approach/table-row-1",
        kind: "table-row",
        text: "Remove me.",
      }),
    ];
    const after = [
      block({ id: "section/approach/paragraph-1", text: "New wording." }),
      block({
        id: "section/approach/code-1",
        kind: "code",
        text: "added();",
      }),
    ];

    const locations = diffRevisions({ before, after });
    expect(
      locations.map((location) => ({
        status: location.status,
        old: location.oldText,
        next: location.newText,
      })),
    ).toEqual([
      { status: "changed", old: "Old wording.", next: "New wording." },
      { status: "removed", old: "Remove me.", next: "" },
      { status: "added", old: "", next: "added();" },
    ]);
    expect(locations[1]).toMatchObject({
      beforeBlockId: "section/approach/code-1",
    });
  });

  it("should keep each revision pair independent when the same block changes twice", () => {
    const first = [
      block({ id: "section/approach/paragraph-1", text: "Version one." }),
    ];
    const second = [
      block({ id: "section/approach/paragraph-1", text: "Version two." }),
    ];
    const third = [
      block({ id: "section/approach/paragraph-1", text: "Version three." }),
    ];

    expect(diffRevisions({ before: first, after: second })[0]).toMatchObject({
      oldText: "Version one.",
      newText: "Version two.",
    });
    expect(diffRevisions({ before: second, after: third })[0]).toMatchObject({
      oldText: "Version two.",
      newText: "Version three.",
    });
  });

  it("should return every place when a large revision adds thirty scopes", () => {
    const after = Array.from({ length: 30 }, (_, index) =>
      block({
        id: `section/slide-${index + 1}/paragraph-1`,
        text: `Added place ${index + 1}.`,
      }),
    );

    expect(diffRevisions({ before: [], after })).toHaveLength(30);
  });
});
