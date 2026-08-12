// Owns the browser-safe projection from a whole-snapshot diff to the places
// attributed to one comment outcome, including honest spillover disclosure.

import type { SnapshotDiff } from "./review-wire.js";

export type AttributedPlaces = {
  readonly placeIds: ReadonlyArray<string>;
  readonly spilloverCount: number;
};

/** Selects every place touching an outcome's server-validated block targets. */
export const attributeDiffPlaces = ({
  diff,
  changeTargets,
}: {
  readonly diff: SnapshotDiff;
  readonly changeTargets: ReadonlyArray<string>;
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
  return {
    placeIds,
    spilloverCount: Math.max(0, diff.places.length - placeIds.length),
  };
};
