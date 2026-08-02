// Exercises the revision-diff seam directly so block attribution stays honest
// when structural ids shift and the viewer asks for old/new word runs.

import { describe, expect, it } from "vitest";
import { diffRevisions, diffWords } from "./revision-diff.js";

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
});
