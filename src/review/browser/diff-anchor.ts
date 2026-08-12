// Decides where a What-changed lens belongs relative to the blocks that
// survive in the current plan. The choice is pure: it turns a diff location
// into an ordered list of candidate block ids, each carrying how the lens sits
// against that block and, when the id comes from an older revision, the text
// the live block must still hold to be trusted. Resolving those ids against
// the live document, and the portal that renders there, stay with the browser
// island.

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
  // The text the id's own snapshot recorded for this block. Present only when
  // the id crossed a snapshot boundary: block ids are structural paths, so an
  // id minted for an older revision can still resolve in a later document
  // while naming different content, and only the recorded text can expose
  // that. Absent when the id and the displayed document share a snapshot.
  readonly expectedText?: string;
};

/**
 * Orders the block ids a location can anchor to, best first. A superseded diff
 * only ever anchors to its own new block: its neighbours describe a plan
 * revision the reader has already moved past, so following them would show the
 * change against unrelated content. That one candidate also carries the
 * result snapshot's text for the block, because the displayed document was
 * rendered from a later snapshot and the id alone cannot prove the block
 * still holds the content the diff is about.
 */
export const lensAnchorCandidates = (
  location: DiffLocation,
  { isSuperseded }: { readonly isSuperseded: boolean },
): ReadonlyArray<LensAnchorCandidate> => {
  if (isSuperseded) {
    return location.newBlockId === undefined
      ? []
      : [
          {
            blockId: location.newBlockId,
            placement: "replace",
            expectedText: location.newText,
          },
        ];
  }
  const ordered: ReadonlyArray<readonly [string | undefined, LensPlacement]> = [
    [location.newBlockId, "replace"],
    [location.beforeBlockId, "before"],
    [location.afterBlockId, "after"],
  ];
  return ordered.flatMap(([blockId, placement]) =>
    blockId === undefined ? [] : [{ blockId, placement }],
  );
};

/**
 * Compares two renderings without erasing case or ordinary token boundaries.
 * The compiler alone inserts newlines around block-level children, so a second
 * comparison may remove only those separators when the live DOM joins them.
 */
const identityText = (value: string): string =>
  value.replace(/\s+/gu, " ").trim();

const withoutCompilerSeparators = (value: string): string =>
  value.replace(/\s*[\r\n]+\s*/gu, "").trim();

/**
 * Whether a live block still holds the content its candidate's id promised.
 * A candidate without an expectation resolved against the displayed
 * document's own snapshot, so the id is proof enough and any live text is
 * accepted; that keeps a legitimately reworded current block anchorable even
 * though its text changed.
 */
export const candidateMatchesLiveText = ({
  candidate,
  liveText,
}: {
  readonly candidate: LensAnchorCandidate;
  readonly liveText: string;
}): boolean =>
  candidate.expectedText === undefined ||
  identityText(candidate.expectedText) === identityText(liveText) ||
  withoutCompilerSeparators(candidate.expectedText) ===
    withoutCompilerSeparators(liveText);

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
