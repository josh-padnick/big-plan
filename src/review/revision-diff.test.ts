// Exercises the revision-diff seam directly so block attribution stays honest
// when structural ids shift and the viewer asks for old/new word runs.

import { describe, expect, it } from "vitest";
import {
  diffRevisions,
  diffRunSimilarity,
  diffWords,
} from "./revision-diff.js";

const block = ({
  id,
  text,
  kind = "paragraph",
  parentBlockId,
  section = "Approach",
}: {
  readonly id: string;
  readonly text: string;
  readonly kind?: string;
  readonly parentBlockId?: string;
  readonly section?: string;
}) => ({
  id,
  kind,
  label: text,
  section,
  text,
  markedText: text,
  ...(parentBlockId === undefined ? {} : { parentBlockId }),
});

describe("revision word diff", () => {
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

  it("should treat two empty revisions as identical", () => {
    expect(diffRunSimilarity([])).toBe(1);
  });
});

describe("revision block alignment", () => {
  it("should preserve a changed row's table parent for container attribution", () => {
    const parentBlockId = "section/approach/table-1";
    const [location] = diffRevisions({
      before: [
        block({
          id: "section/approach/table-row-1",
          kind: "table-row",
          text: "timeout\n504",
          parentBlockId,
        }),
      ],
      after: [
        block({
          id: "section/approach/table-row-1",
          kind: "table-row",
          text: "timeout\n503",
          parentBlockId,
        }),
      ],
    });
    expect(location).toMatchObject({
      kind: "table-row",
      parentBlockId,
    });
  });

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

  it("should anchor a boundary removal to a neighbor in the same section", () => {
    const locations = diffRevisions({
      before: [
        block({
          id: "section/approach/heading-1",
          kind: "heading",
          text: "Approach",
        }),
        block({
          id: "section/approach/paragraph-1",
          text: "Remove at the boundary.",
        }),
        block({
          id: "section/results/heading-1",
          kind: "heading",
          text: "Results",
          section: "Results",
        }),
      ],
      after: [
        block({
          id: "section/approach/heading-1",
          kind: "heading",
          text: "Approach",
        }),
        block({
          id: "section/results/heading-1",
          kind: "heading",
          text: "Results",
          section: "Results",
        }),
      ],
    });
    expect(
      locations.find((location) => location.oldText === "Remove at the boundary."),
    ).toMatchObject({
      status: "removed",
      afterBlockId: "section/approach/heading-1",
    });
    expect(
      locations.find((location) => location.oldText === "Remove at the boundary."),
    ).not.toHaveProperty("beforeBlockId");
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
