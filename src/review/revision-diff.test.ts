// Exercises the revision-diff seam directly so block attribution stays honest
// when structural ids shift and the viewer asks for old/new word runs.

import { describe, expect, it } from "vitest";
import {
  bandText,
  diffKindShowsComment,
  diffLocationMatchesTarget,
  diffPresentationMode,
  diffRevisions,
  diffRunSimilarity,
  diffWords,
  markedOffsetForPlainOffset,
} from "./revision-diff.js";

const block = ({
  id,
  text,
  kind = "paragraph",
  parentBlockId,
}: {
  readonly id: string;
  readonly text: string;
  readonly kind?: string;
  readonly parentBlockId?: string;
}) => ({
  id,
  kind,
  label: text,
  section: "Approach",
  text,
  markedText: text,
  ...(parentBlockId === undefined ? {} : { parentBlockId }),
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

  it("should keep focused edits inline and move high-churn rewrites to bands", () => {
    expect(
      diffPresentationMode([
        { op: "same", text: "The " },
        { op: "del", text: "worker " },
        { op: "ins", text: "processor " },
        { op: "same", text: "classifies " },
        { op: "del", text: "responses " },
        { op: "ins", text: "failures " },
        { op: "same", text: "into " },
        { op: "del", text: "retryable " },
        { op: "ins", text: "bounded " },
        { op: "same", text: "and " },
        { op: "del", text: "terminal " },
        { op: "ins", text: "explicit " },
        { op: "same", text: "outcomes." },
      ]),
    ).toBe("bands");
    expect(
      diffPresentationMode([
        { op: "same", text: "Keep this detailed sentence and change only " },
        { op: "del", text: "two old" },
        { op: "ins", text: "two new" },
        { op: "same", text: " words at the end." },
      ]),
    ).toBe("inline");
  });

  it("should translate plain offsets across inline-code sentinels", () => {
    const markedText = `Use \u0011timeout\u0011 now.`;
    expect(markedOffsetForPlainOffset({ markedText, plainOffset: 4 })).toBe(4);
    expect(markedOffsetForPlainOffset({ markedText, plainOffset: 11 })).toBe(
      12,
    );
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
    expect(
      location &&
        diffLocationMatchesTarget({ location, target: parentBlockId }),
    ).toBe(true);
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
