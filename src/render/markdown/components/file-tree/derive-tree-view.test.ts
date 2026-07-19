// Tests FileTreeDiff state derivation, including subtree filtering, empty
// surviving directories, explicit rename names, and marker sidedness.

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
  it("should skip added subtrees before and removed subtrees after", () => {
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
    expect(after).not.toContain("removed/");
    expect(after).not.toContain("only-before.ts");
    expect(after).toContain("added/");
    expect(after).toContain("only-after.ts");
  });

  it("should retain directories emptied by state filtering", () => {
    const before = deriveTreeView({ entries: parsedEntries(), side: "before" });
    const after = deriveTreeView({ entries: parsedEntries(), side: "after" });
    const beforeChildren = before[0]?.children ?? [];
    const afterChildren = after[0]?.children ?? [];

    expect(
      beforeChildren.find((entry) => entry.name === "emptied-before/")
        ?.children,
    ).toEqual([]);
    expect(
      afterChildren.find((entry) => entry.name === "emptied-after/")?.children,
    ).toEqual([]);
  });

  it("should select rename names and apply markers only on their relevant sides", () => {
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
    expect(before).toContain('"badge":"removed"');
    expect(before).not.toContain('"badge":"added"');
    expect(after).toContain('"badge":"added"');
    expect(after).not.toContain('"badge":"removed"');
    expect(before).toContain('"badge":"modified"');
    expect(before).toContain('"badge":"renamed"');
    expect(after).toContain('"badge":"modified"');
    expect(after).toContain('"badge":"renamed"');
  });
});
