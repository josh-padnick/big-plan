// Decides where a What-changed lens belongs relative to the blocks that
// survive in the current plan. The choice is pure: it turns a diff location
// into an ordered list of candidate block ids, each carrying how the lens sits
// against that block. Resolving those ids against the live document, and the
// portal that renders there, stay with the browser island.

import type {
  DiffLocation,
  DiffPlace,
  SnapshotDiff,
} from "../shared/review-wire.js";

/**
 * How a lens sits against the block it resolved to. A changed block is
 * replaced by its lens; a removed block has no surviving block of its own, so
 * its lens renders on the side of a neighbour that it used to sit on.
 */
export type LensPlacement = "replace" | "before" | "after";

export type LensAnchorCandidate = {
  readonly blockId: string;
  readonly placement: LensPlacement;
};

/**
 * Orders the block ids a location can anchor to, best first. A superseded diff
 * only ever anchors to its own new block: its neighbours describe a plan
 * revision the reader has already moved past, so following them would show the
 * change against unrelated content.
 */
export const lensAnchorCandidates = (
  location: DiffLocation,
  { isSuperseded }: { readonly isSuperseded: boolean },
): ReadonlyArray<LensAnchorCandidate> => {
  const ordered: ReadonlyArray<readonly [string | undefined, LensPlacement]> =
    isSuperseded
      ? [[location.newBlockId, "replace"]]
      : [
          [location.newBlockId, "replace"],
          [location.beforeBlockId, "before"],
          [location.afterBlockId, "after"],
        ];
  return ordered.flatMap(([blockId, placement]) =>
    blockId === undefined ? [] : [{ blockId, placement }],
  );
};

/**
 * Resolves the place a tour should open on. The stepper walks the diff's own
 * place order, so a requested place is found in that order rather than in the
 * caller's list, and an unknown place opens the tour at its start instead of
 * silently landing on whichever change the caller happened to list first.
 */
export const tourStartIndex = ({
  diff,
  placeIds,
  startPlaceId,
}: {
  readonly diff: SnapshotDiff;
  readonly placeIds: ReadonlyArray<string>;
  readonly startPlaceId?: string;
}): number => {
  if (startPlaceId === undefined) return 0;
  const allowed = new Set(placeIds);
  const index = diff.places
    .filter((place: DiffPlace) => allowed.has(place.placeId))
    .findIndex((place) => place.placeId === startPlaceId);
  return index < 0 ? 0 : index;
};
