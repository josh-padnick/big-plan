// Exercises the snapshot-diff seam directly so block attribution stays honest
// when structural ids shift and the viewer asks for old/new word runs.

import { describe, expect, it } from "vitest";
import {
  buildSnapshotDiff,
  diffRunSimilarity,
  diffSnapshots,
  diffWords,
} from "./snapshot-diff.js";

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

describe("snapshot word diff", () => {
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

  it("should distinguish a focused rewording from a wholesale rewrite", () => {
    expect(
      diffRunSimilarity(
        diffWords({
          before: "Keep the first version.",
          after: "Keep the stable version.",
        }),
      ),
    ).toBeGreaterThan(0.2);
    expect(
      diffRunSimilarity(
        diffWords({
          before: "Retry every request with exponential backoff.",
          after: "Queue failed operations for a bounded manual replay window.",
        }),
      ),
    ).toBeLessThan(0.2);
  });
});

describe("snapshot block alignment", () => {
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

    expect(diffSnapshots({ before, after })).toEqual([
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

    const locations = diffSnapshots({ before, after });
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

    expect(diffSnapshots({ before: first, after: second })[0]).toMatchObject({
      oldText: "Version one.",
      newText: "Version two.",
    });
    expect(diffSnapshots({ before: second, after: third })[0]).toMatchObject({
      oldText: "Version two.",
      newText: "Version three.",
    });
  });

  it("should not pull an unchanged diagram into an adjacent heading rewrite", () => {
    const unchangedDiagram = "claims succeeds when retry budget is available";
    const locations = diffSnapshots({
      before: [
        block({
          id: "section/old/heading-1",
          kind: "heading",
          text: "Old heading",
        }),
        block({
          id: "section/old/flow-diagram-1",
          kind: "flow-diagram",
          text: unchangedDiagram,
        }),
      ],
      after: [
        block({
          id: "section/new/heading-1",
          kind: "heading",
          text: "New heading",
        }),
        block({
          id: "section/new/flow-diagram-1",
          kind: "flow-diagram",
          text: unchangedDiagram,
        }),
      ],
    });
    expect(
      locations.filter((location) => location.kind === "flow-diagram"),
    ).toEqual([]);
  });

  it("should exclude derived table-of-contents blocks", () => {
    expect(
      diffSnapshots({
        before: [
          block({
            id: "section/summary/table-of-contents-1",
            kind: "table-of-contents",
            text: "Old",
          }),
        ],
        after: [
          block({
            id: "section/summary/table-of-contents-1",
            kind: "table-of-contents",
            text: "New",
          }),
        ],
      }),
    ).toEqual([]);
  });

  it("should group contiguous locations and keep stable place ids", () => {
    const before = [
      block({ id: "section/approach/paragraph-1", text: "Retry forever." }),
      block({ id: "section/approach/paragraph-2", text: "Use a fixed delay." }),
    ];
    const after = [
      block({
        id: "section/approach/paragraph-1",
        text: "Stop after five attempts.",
      }),
      block({ id: "section/approach/paragraph-2", text: "Use full jitter." }),
    ];
    const first = buildSnapshotDiff({
      from: "a".repeat(16),
      to: "b".repeat(16),
      before,
      after,
    });
    const second = buildSnapshotDiff({
      from: "a".repeat(16),
      to: "b".repeat(16),
      before,
      after,
    });
    expect(first.places).toHaveLength(1);
    expect(first.places[0]).toMatchObject({
      label: "Whole section",
      note: "rewritten",
    });
    expect(second.places[0]?.placeId).toBe(first.places[0]?.placeId);
  });

  it("should keep one table revision together as one review place", () => {
    const before = [
      block({
        id: "section/approach/table-1",
        kind: "table",
        text: "Name\nValue\nAlpha\nOne",
      }),
      block({
        id: "section/approach/table-row-1",
        kind: "table-row",
        text: "Name\nValue",
      }),
      block({
        id: "section/approach/table-cell-1-1",
        kind: "table-cell",
        text: "Name",
      }),
      block({
        id: "section/approach/table-cell-1-2",
        kind: "table-cell",
        text: "Value",
      }),
      block({
        id: "section/approach/table-row-2",
        kind: "table-row",
        text: "Alpha\nOne",
      }),
      block({
        id: "section/approach/table-cell-2-1",
        kind: "table-cell",
        text: "Alpha",
      }),
      block({
        id: "section/approach/table-cell-2-2",
        kind: "table-cell",
        text: "One",
      }),
    ];
    const after = [
      block({
        id: "section/approach/table-1",
        kind: "table",
        text: "Name\nValue\nEvidence\nAlpha\nOne\nBaseline",
      }),
      block({
        id: "section/approach/table-row-1",
        kind: "table-row",
        text: "Name\nValue\nEvidence",
      }),
      block({
        id: "section/approach/table-cell-1-1",
        kind: "table-cell",
        text: "Name",
      }),
      block({
        id: "section/approach/table-cell-1-2",
        kind: "table-cell",
        text: "Value",
      }),
      block({
        id: "section/approach/table-column-3",
        kind: "table-column",
        text: "Evidence",
      }),
      block({
        id: "section/approach/table-row-2",
        kind: "table-row",
        text: "Alpha\nOne\nBaseline",
      }),
      block({
        id: "section/approach/table-cell-2-1",
        kind: "table-cell",
        text: "Alpha",
      }),
      block({
        id: "section/approach/table-cell-2-2",
        kind: "table-cell",
        text: "One",
      }),
      block({
        id: "section/approach/table-cell-2-3",
        kind: "table-cell",
        text: "Baseline",
      }),
    ];

    const diff = buildSnapshotDiff({
      from: "a".repeat(16),
      to: "b".repeat(16),
      before,
      after,
    });

    expect(diff.places).toHaveLength(1);
    expect(diff.places[0]?.locationIndexes).toHaveLength(5);
  });
});
