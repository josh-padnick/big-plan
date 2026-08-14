// Exercises the snapshot-diff seam directly so block attribution stays honest
// when structural ids shift and the viewer asks for old/new word runs.

import { describe, expect, it } from "vitest";
import {
  buildSnapshotDiff,
  diffRunSimilarity,
  diffSnapshots,
  diffWords,
  usesRenderedSnapshot,
  type BlockPresentation,
} from "./snapshot-diff.js";

const block = ({
  id,
  text,
  kind = "paragraph",
  label,
  isComponentRoot = false,
  ownerId,
  presentation,
}: {
  readonly id: string;
  readonly text: string;
  readonly kind?: string;
  readonly label?: string;
  readonly isComponentRoot?: boolean;
  readonly ownerId?: string;
  readonly presentation?: BlockPresentation;
}) => ({
  id,
  kind,
  label: label ?? text,
  section: "Approach",
  text,
  isComponentRoot,
  ...(ownerId === undefined ? {} : { ownerId }),
  ...(presentation === undefined ? {} : { presentation }),
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
  it("should preserve exact counterparts after an insertion larger than the fuzzy window", () => {
    const before = Array.from({ length: 5 }, (_, index) =>
      block({
        id: `section/approach/paragraph-${index + 1}`,
        text: `Stable paragraph ${index + 1}.`,
      }),
    );
    const inserted = Array.from({ length: 81 }, (_, index) =>
      block({
        id: `section/approach/paragraph-${index + 1}`,
        text: `Inserted paragraph ${index + 1}.`,
      }),
    );
    const after = [
      ...inserted,
      ...before.map((entry, index) => ({
        ...entry,
        id: `section/approach/paragraph-${inserted.length + index + 1}`,
      })),
    ];

    const locations = diffSnapshots({ before, after });
    expect(locations).toHaveLength(inserted.length);
    expect(locations.every((location) => location.status === "added")).toBe(
      true,
    );
    expect(locations.map((location) => location.newText)).toEqual(
      inserted.map((entry) => entry.text),
    );
  });

  it("should report a capitalization-only edit", () => {
    expect(
      diffSnapshots({
        before: [
          block({
            id: "section/approach/paragraph-1",
            text: "Use the api contract.",
          }),
        ],
        after: [
          block({
            id: "section/approach/paragraph-1",
            text: "Use the API contract.",
          }),
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        status: "changed",
        oldText: "Use the api contract.",
        newText: "Use the API contract.",
      }),
    ]);
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
        ownerId: "section/approach/table-1",
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

  it("should carry each side's own presentation facts through a change, removal, and addition", () => {
    const before = [
      block({
        id: "section/approach/callout-1",
        kind: "callout",
        text: "Rollback risk\nData loss stays possible until the backfill completes.",
        label: "Rollback risk",
        isComponentRoot: true,
        presentation: { aspect: "callout", calloutType: "danger" },
      }),
      block({
        id: "section/approach/list-1",
        kind: "list",
        text: "Freeze writes.\nBackfill twice.",
        presentation: { aspect: "list", isOrdered: true },
      }),
    ];
    const after = [
      block({
        id: "section/approach/callout-1",
        kind: "callout",
        text: "Rollback risk\nData loss stays possible until the backfill is verified.",
        label: "Rollback risk",
        isComponentRoot: true,
        presentation: { aspect: "callout", calloutType: "warning" },
      }),
      block({
        id: "section/approach/list-2",
        kind: "list",
        text: "Watch the error budget.\nPage the on-call.",
        presentation: { aspect: "list", isOrdered: false },
      }),
    ];

    const locations = diffSnapshots({ before, after });
    expect(
      locations.map((location) => ({
        status: location.status,
        oldPresentation: location.oldPresentation,
        newPresentation: location.newPresentation,
      })),
    ).toEqual([
      {
        status: "changed",
        oldPresentation: { aspect: "callout", calloutType: "danger" },
        newPresentation: { aspect: "callout", calloutType: "warning" },
      },
      {
        status: "removed",
        oldPresentation: { aspect: "list", isOrdered: true },
        newPresentation: undefined,
      },
      {
        status: "added",
        oldPresentation: undefined,
        newPresentation: { aspect: "list", isOrdered: false },
      },
    ]);
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

  it("should keep adjacent rendered components as separate review places", () => {
    const before = [
      block({
        id: "section/approach/decision-1",
        kind: "decision",
        text: "Old decision",
        isComponentRoot: true,
      }),
      block({
        id: "section/approach/flow-diagram-1",
        kind: "flow-diagram",
        text: "Old diagram",
        isComponentRoot: true,
      }),
    ];
    const after = [
      block({
        id: "section/approach/decision-1",
        kind: "decision",
        text: "New decision",
        isComponentRoot: true,
      }),
      block({
        id: "section/approach/flow-diagram-1",
        kind: "flow-diagram",
        text: "New diagram",
        isComponentRoot: true,
      }),
    ];

    const diff = buildSnapshotDiff({
      from: "a".repeat(16),
      to: "b".repeat(16),
      before,
      after,
    });

    expect(diff.places).toHaveLength(2);
    expect(diff.locations.every((location) => location.runs.length === 2)).toBe(
      true,
    );
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
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-cell-1-1",
        kind: "table-cell",
        text: "Name",
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-cell-1-2",
        kind: "table-cell",
        text: "Value",
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-row-2",
        kind: "table-row",
        text: "Alpha\nOne",
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-cell-2-1",
        kind: "table-cell",
        text: "Alpha",
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-cell-2-2",
        kind: "table-cell",
        text: "One",
        ownerId: "section/approach/table-1",
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
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-cell-1-1",
        kind: "table-cell",
        text: "Name",
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-cell-1-2",
        kind: "table-cell",
        text: "Value",
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-column-3",
        kind: "table-column",
        text: "Evidence",
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-row-2",
        kind: "table-row",
        text: "Alpha\nOne\nBaseline",
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-cell-2-1",
        kind: "table-cell",
        text: "Alpha",
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-cell-2-2",
        kind: "table-cell",
        text: "One",
        ownerId: "section/approach/table-1",
      }),
      block({
        id: "section/approach/table-cell-2-3",
        kind: "table-cell",
        text: "Baseline",
        ownerId: "section/approach/table-1",
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

  it("should replace both sides wholesale when any component root without a text treatment changes", () => {
    const locations = diffSnapshots({
      before: [
        block({
          id: "section/approach/wireframe-1",
          kind: "wireframe",
          text: "Restore a historical version",
          isComponentRoot: true,
        }),
      ],
      after: [
        block({
          id: "section/approach/wireframe-1",
          kind: "wireframe",
          text: "Restore the selected historical version",
          isComponentRoot: true,
        }),
      ],
    });
    expect(locations[0]?.runs.map((run) => run.op)).toEqual(["del", "ins"]);
  });

  it("should keep word-level runs when a component root has a dedicated text treatment", () => {
    const locations = diffSnapshots({
      before: [
        block({
          id: "document/quick-summary-1",
          kind: "quick-summary",
          text: "Quick summary\nWhy\nValue holds.",
          isComponentRoot: true,
        }),
      ],
      after: [
        block({
          id: "document/quick-summary-1",
          kind: "quick-summary",
          text: "Quick summary\nWhy\nValue compounds.",
          isComponentRoot: true,
        }),
      ],
    });
    expect(locations[0]?.runs.some((run) => run.op === "same")).toBe(true);
  });

  it("should group a component root with its non-adjacent declared internal when both change", () => {
    const summary = ({ how }: { readonly how: string }) => [
      block({
        id: "document/quick-summary-1",
        kind: "quick-summary",
        label: "Quick summary",
        text: `Quick summary\nWhy\nValue.\nWhat\nBuild it.\nHow\n${how}`,
        isComponentRoot: true,
      }),
      block({
        id: "document/quick-summary-facet-1",
        kind: "quick-summary-facet",
        label: "Why",
        text: "Why\nValue.",
        ownerId: "document/quick-summary-1",
      }),
      block({
        id: "document/quick-summary-facet-2",
        kind: "quick-summary-facet",
        label: "What",
        text: "What\nBuild it.",
        ownerId: "document/quick-summary-1",
      }),
      block({
        id: "document/quick-summary-facet-3",
        kind: "quick-summary-facet",
        label: "How",
        text: `How\n${how}`,
        ownerId: "document/quick-summary-1",
      }),
    ];

    const diff = buildSnapshotDiff({
      from: "a".repeat(16),
      to: "b".repeat(16),
      before: summary({ how: "Carefully." }),
      after: summary({ how: "Very carefully." }),
    });

    expect(diff.places).toHaveLength(1);
    expect(diff.places[0]).toMatchObject({
      label: "Quick summary",
      note: "reworded",
    });
    expect(diff.places[0]?.locationIndexes).toHaveLength(2);
  });

  it("should group a field-bearing component root with its changed field and keep word runs", () => {
    const endpoint = ({ summary }: { readonly summary: string }) => [
      block({
        id: "section/api/http-endpoint-1",
        kind: "http-endpoint",
        label: "Http endpoint",
        text: `POST /queue ${summary}\nDescription of the endpoint.`,
        isComponentRoot: true,
      }),
      block({
        id: "section/api/http-endpoint-field-1",
        kind: "http-endpoint-field",
        label: "POST /queue",
        text: `POST /queue ${summary}`,
        ownerId: "section/api/http-endpoint-1",
      }),
    ];

    const diff = buildSnapshotDiff({
      from: "a".repeat(16),
      to: "b".repeat(16),
      before: endpoint({ summary: "Queue a refresh" }),
      after: endpoint({ summary: "Queue one refresh" }),
    });

    expect(diff.places).toHaveLength(1);
    expect(diff.places[0]).toMatchObject({
      label: "Http endpoint",
      note: "reworded",
    });
    const field = diff.locations.find(
      (location) => location.kind === "http-endpoint-field",
    );
    expect(field?.runs.some((run) => run.op === "same")).toBe(true);
  });

  it("should keep two adjacent field-bearing components as separate review places when both change", () => {
    const cards = ({ suffix }: { readonly suffix: string }) => [
      block({
        id: "section/api/http-endpoint-1",
        kind: "http-endpoint",
        label: "Http endpoint",
        text: `POST /queue Queue ${suffix}`,
        isComponentRoot: true,
      }),
      block({
        id: "section/api/http-endpoint-field-1",
        kind: "http-endpoint-field",
        label: "POST /queue",
        text: `POST /queue Queue ${suffix}`,
        ownerId: "section/api/http-endpoint-1",
      }),
      block({
        id: "section/api/http-endpoint-2",
        kind: "http-endpoint",
        label: "Http endpoint",
        text: `GET /queue Read ${suffix}`,
        isComponentRoot: true,
      }),
      block({
        id: "section/api/http-endpoint-field-2",
        kind: "http-endpoint-field",
        label: "GET /queue",
        text: `GET /queue Read ${suffix}`,
        ownerId: "section/api/http-endpoint-2",
      }),
    ];

    const diff = buildSnapshotDiff({
      from: "a".repeat(16),
      to: "b".repeat(16),
      before: cards({ suffix: "a refresh" }),
      after: cards({ suffix: "one refresh" }),
    });

    expect(diff.places).toHaveLength(2);
  });
});

describe("rendered snapshot rule", () => {
  it("should give every component root a rendered snapshot when no text treatment exists", () => {
    for (const kind of ["wireframe", "decision", "a-future-component"]) {
      expect(usesRenderedSnapshot({ kind, isComponentRoot: true })).toBe(true);
    }
  });

  it("should keep text-treatment components and ordinary blocks on the text path", () => {
    for (const kind of [
      "callout",
      "code-snippet",
      "code-diff",
      "data-table",
      "quick-summary",
      "http-endpoint",
      "graphql-operation",
      "grpc-method",
      "database-table-schema",
    ]) {
      expect(usesRenderedSnapshot({ kind, isComponentRoot: true })).toBe(false);
    }
    expect(
      usesRenderedSnapshot({ kind: "paragraph", isComponentRoot: false }),
    ).toBe(false);
  });

  it("should give an authored picture a rendered snapshot even though it is no component", () => {
    expect(
      usesRenderedSnapshot({ kind: "image", isComponentRoot: false }),
    ).toBe(true);
  });
});

describe("picture changes", () => {
  const picture = ({
    id,
    source,
    alt,
  }: {
    readonly id: string;
    readonly source: string;
    readonly alt: string;
  }) =>
    block({
      id,
      text: "",
      kind: "image",
      label: alt,
      presentation: { aspect: "image", source, alt },
    });

  it("should report a swapped picture whose words never changed", () => {
    const diff = buildSnapshotDiff({
      from: "a".repeat(16),
      to: "b".repeat(16),
      before: [
        picture({ id: "s/image-1", source: "./assets/before.png", alt: "Map" }),
      ],
      after: [
        picture({ id: "s/image-1", source: "./assets/after.png", alt: "Map" }),
      ],
    });
    expect(diff.locations).toHaveLength(1);
    expect(diff.locations[0]).toMatchObject({
      status: "changed",
      kind: "image",
      oldBlockId: "s/image-1",
      newBlockId: "s/image-1",
    });
    expect(diff.places[0]?.note).toBe("replaced");
    expect(diff.places[0]?.label).toBe("Map");
  });

  it("should report a re-captioned picture and leave an untouched one alone", () => {
    const unchanged = picture({
      id: "s/image-1",
      source: "./assets/one.png",
      alt: "Map",
    });
    const diff = buildSnapshotDiff({
      from: "a".repeat(16),
      to: "b".repeat(16),
      before: [
        unchanged,
        picture({ id: "s/image-2", source: "./assets/two.png", alt: "Flow" }),
      ],
      after: [
        unchanged,
        picture({
          id: "s/image-2",
          source: "./assets/two.png",
          alt: "Flow, revised",
        }),
      ],
    });
    expect(diff.locations).toHaveLength(1);
    expect(diff.locations[0]?.newBlockId).toBe("s/image-2");
  });
});
