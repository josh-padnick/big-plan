// Derives FileTreeDiff's before and after hierarchies from one authored tree.
// The before tree is the unchanged snapshot - old names, no markers - while
// the after tree carries every change marker, keeping deleted entries as
// struck-through tombstones so removals stay visible beside what replaced
// them.

import type { TreeBadge, TreeEntry } from "./parse-tree-text.js";

export type FileTreeDiffSide = "before" | "after";

const excludedFromSide = ({
  entry,
  side,
}: {
  readonly entry: TreeEntry;
  readonly side: FileTreeDiffSide;
}): boolean => side === "before" && entry.badge === "added";

/** Returns the change marker that applies on one side of the diff. */
export const markerForTreeSide = ({
  entry,
  side,
}: {
  readonly entry: TreeEntry;
  readonly side: FileTreeDiffSide;
}): TreeBadge | undefined => (side === "after" ? entry.badge : undefined);

/** Filters and renames a hierarchy for one state without dropping empty dirs. */
export const deriveTreeView = ({
  entries,
  side,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly side: FileTreeDiffSide;
}): ReadonlyArray<TreeEntry> =>
  entries.flatMap((entry) => {
    if (excludedFromSide({ entry, side })) {
      return [];
    }
    const marker = markerForTreeSide({ entry, side });
    return [
      {
        name: side === "before" ? (entry.oldName ?? entry.name) : entry.name,
        kind: entry.kind,
        ...(marker === undefined ? {} : { badge: marker }),
        ...(entry.note === undefined ? {} : { note: entry.note }),
        children: deriveTreeView({ entries: entry.children, side }),
      },
    ];
  });

/** Detects whether a tree contains at least one diff-bearing entry. */
export const hasTreeChanges = ({
  entries,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
}): boolean =>
  entries.some(
    (entry) =>
      entry.badge !== undefined || hasTreeChanges({ entries: entry.children }),
  );
