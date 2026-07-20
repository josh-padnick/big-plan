// Tests FileTreeDiff state derivation: the unmarked before snapshot, the
// fully marked after tree with deletion tombstones, subtree filtering, empty
// surviving directories, and explicit rename names.

import { describe, expect, it } from "vitest";
import { deriveTreeView } from "./derive-tree-view.js";
import { parseTreeText } from "./parse-tree-text.js";

const source = `src/
  added/ [added]
    only-after.ts [modified]
  removed/ [removed]
    only-before.ts [modified]
  emptied-before/
    new-child.ts [added]
  emptied-after/
    old-child.ts [removed]
  old.ts -> new.ts [renamed]
  changed.ts [modified]
  stable.ts
`;

const parsedEntries = () => parseTreeText({ source, mode: "diff" }).entries;

describe("deriveTreeView", () => {
  it("should skip added subtrees before and keep removed subtrees after as tombstones", () => {
    const before = JSON.stringify(
      deriveTreeView({
        entries: parsedEntries(),
        side: "before",
      }),
    );
    const after = JSON.stringify(
      deriveTreeView({
        entries: parsedEntries(),
        side: "after",
      }),
    );

    expect(before).not.toContain("added/");
    expect(before).not.toContain("only-after.ts");
    expect(before).toContain("removed/");
    expect(before).toContain("only-before.ts");
    expect(after).toContain("removed/");
    expect(after).toContain("only-before.ts");
    expect(after).toContain("added/");
    expect(after).toContain("only-after.ts");
  });

  it("should retain directories emptied by state filtering", () => {
    const before = deriveTreeView({ entries: parsedEntries(), side: "before" });
    const beforeChildren = before[0]?.children ?? [];

    expect(
      beforeChildren.find((entry) => entry.name === "emptied-before/")
        ?.children,
    ).toEqual([]);
  });

  it("should derive the plain final state when changes are hidden", () => {
    const finalState = JSON.stringify(
      deriveTreeView({
        entries: parsedEntries(),
        side: "after",
        showChanges: false,
      }),
    );

    expect(finalState).not.toContain('"badge"');
    expect(finalState).not.toContain("removed/");
    expect(finalState).not.toContain("only-before.ts");
    expect(finalState).toContain("added/");
    expect(finalState).toContain('"name":"new.ts"');
    expect(finalState).toContain("changed.ts");
  });

  it("should select rename names and keep every marker on the after side", () => {
    const before = JSON.stringify(
      deriveTreeView({
        entries: parsedEntries(),
        side: "before",
      }),
    );
    const after = JSON.stringify(
      deriveTreeView({
        entries: parsedEntries(),
        side: "after",
      }),
    );

    expect(before).toContain('"name":"old.ts"');
    expect(before).not.toContain('"name":"new.ts"');
    expect(after).toContain('"name":"new.ts"');
    expect(after).not.toContain('"name":"old.ts"');
    // The before tree is by definition unchanged, so it carries no markers;
    // every change, including deletion tombstones, reads on the after tree.
    expect(before).not.toContain('"badge"');
    expect(after).toContain('"badge":"added"');
    expect(after).toContain('"badge":"removed"');
    expect(after).toContain('"badge":"modified"');
    expect(after).toContain('"badge":"renamed"');
  });
});
