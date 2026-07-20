// Derives FileTreeDiff's before and after hierarchies from one authored tree.
// The before tree is the unchanged snapshot - old names, no markers - while
// the after tree carries every change marker, keeping deleted entries as
// struck-through tombstones so removals stay visible beside what replaced
// them. With showChanges off the after tree becomes the plain final state:
// no markers and no tombstones, just the hierarchy the plan produces.

import type { TreeBadge, TreeEntry } from "./parse-tree-text.js";

export type FileTreeDiffSide = "before" | "after";

const excludedFromSide = ({
  entry,
  side,
  showChanges,
}: {
  readonly entry: TreeEntry;
  readonly side: FileTreeDiffSide;
  readonly showChanges: boolean;
}): boolean =>
  (side === "before" && entry.badge === "added") ||
  (side === "after" && !showChanges && entry.badge === "removed");

/** Returns the change marker that applies on one side of the diff. */
export const markerForTreeSide = ({
  entry,
  side,
  showChanges,
}: {
  readonly entry: TreeEntry;
  readonly side: FileTreeDiffSide;
  readonly showChanges: boolean;
}): TreeBadge | undefined =>
  side === "after" && showChanges ? entry.badge : undefined;

/** Filters and renames a hierarchy for one state without dropping empty dirs. */
export const deriveTreeView = ({
  entries,
  side,
  showChanges = true,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly side: FileTreeDiffSide;
  readonly showChanges?: boolean;
}): ReadonlyArray<TreeEntry> =>
  entries.flatMap((entry) => {
    if (excludedFromSide({ entry, side, showChanges })) {
      return [];
    }
    const marker = markerForTreeSide({ entry, side, showChanges });
    return [
      {
        name: side === "before" ? (entry.oldName ?? entry.name) : entry.name,
        kind: entry.kind,
        ...(marker === undefined ? {} : { badge: marker }),
        ...(entry.note === undefined ? {} : { note: entry.note }),
        children: deriveTreeView({
          entries: entry.children,
          side,
          showChanges,
        }),
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
