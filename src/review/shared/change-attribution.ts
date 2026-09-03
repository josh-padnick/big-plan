// Owns the browser-safe projection from a whole-snapshot diff to the places
// attributed to one comment outcome, including honest spillover disclosure.
//
// Disclosure is named rather than counted wherever the runtime could say whose
// work the rest of the diff is. A thread's span routinely contains another
// thread's revision - one revision line, one fold - and "3 other changes" tells
// a reviewer only that something they cannot see is in view. Naming the change
// sets those places belong to is what turns that into something they can act
// on. The count stays beside it for the places nobody declared, because those
// have no owner to name and pretending otherwise would be worse than a number.

import type { SnapshotDiff } from "./review-wire.js";

/** Another change set whose work sits inside the span being attributed. */
export type ForeignChangeSet = {
  readonly changeSetId: string;
  readonly placeCount: number;
};

export type AttributedPlaces = {
  readonly placeIds: ReadonlyArray<string>;
  readonly spilloverCount: number;
  /** The named owners of the spillover, most places first. */
  readonly foreign: ReadonlyArray<ForeignChangeSet>;
};

/** Selects every place touching an outcome's server-validated block targets. */
export const attributeDiffPlaces = ({
  diff,
  changeTargets,
  changeSetId,
}: {
  readonly diff: SnapshotDiff;
  readonly changeTargets: ReadonlyArray<string>;
  /** The set being attributed, so its own places are never reported foreign. */
  readonly changeSetId?: string;
}): AttributedPlaces => {
  const targets = new Set(changeTargets);
  const placeIds = diff.places.flatMap((place) => {
    const isOwned = place.locationIndexes.some((index) => {
      const location = diff.locations.at(index);
      return (
        location !== undefined &&
        [location.oldBlockId, location.newBlockId].some(
          (blockId) => blockId !== undefined && targets.has(blockId),
        )
      );
    });
    return isOwned ? [place.placeId] : [];
  });
  const attributed = new Set(placeIds);
  const counts = new Map<string, number>();
  for (const place of diff.places) {
    if (attributed.has(place.placeId)) continue;
    for (const owner of place.ownerChangeSetIds ?? []) {
      if (owner === changeSetId) continue;
      counts.set(owner, (counts.get(owner) ?? 0) + 1);
    }
  }
  return {
    placeIds,
    spilloverCount: Math.max(0, diff.places.length - placeIds.length),
    foreign: [...counts]
      .map(([id, placeCount]) => ({ changeSetId: id, placeCount }))
      // Ties keep the runtime's own order, so two reads of one diff never
      // present the same disclosure in two different orders.
      .sort((left, right) => right.placeCount - left.placeCount),
  };
};
