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

export type TreeChangeCounts = {
  readonly added: number;
  readonly modified: number;
  readonly removed: number;
  readonly renamed: number;
};

/** Tallies change badges across a subtree, as chosen by the caller's badge. */
export const countTreeChanges = ({
  entries,
  badgeForEntry,
}: {
  readonly entries: ReadonlyArray<TreeEntry>;
  readonly badgeForEntry: (entry: TreeEntry) => TreeBadge | undefined;
}): TreeChangeCounts =>
  entries.reduce(
    (counts, entry) => {
      const badge = badgeForEntry(entry);
      const nested = countTreeChanges({
        entries: entry.children,
        badgeForEntry,
      });
      return {
        added: counts.added + nested.added + (badge === "added" ? 1 : 0),
        modified:
          counts.modified + nested.modified + (badge === "modified" ? 1 : 0),
        removed:
          counts.removed + nested.removed + (badge === "removed" ? 1 : 0),
        renamed:
          counts.renamed + nested.renamed + (badge === "renamed" ? 1 : 0),
      };
    },
    { added: 0, modified: 0, removed: 0, renamed: 0 },
  );

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
