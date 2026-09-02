// Decides where a What-changed lens belongs relative to the blocks that
// survive in the current plan. The choice is pure: it turns a diff location
// into an ordered list of candidate block ids, each carrying how the lens sits
// against that block and, when the id comes from an older revision, the content
// facts the live block must still hold to be trusted. Resolving those ids
// against the live document, and the portal that renders there, stay with the
// browser island.

import type {
  BlockPresentation,
  DiffLocation,
  DiffPlace,
  SnapshotDiff,
} from "../shared/review-wire.js";

type PicturePresentation = Extract<BlockPresentation, { aspect: "image" }>;

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
  // while naming different content, and only the recorded content can expose
  // that. Expectations are absent when the id and document share a snapshot.
  readonly expectedText?: string;
  readonly expectedPicture?: PicturePresentation;
  // The block kind the id named when the change was recorded. Carried instead
  // of the text for a location that brought its own rendering, because those
  // two questions are not the same one: text asks whether the block still says
  // what it said, and a component revised again honestly answers no while
  // still being the component the change is about.
  readonly expectedKind?: string;
};

/**
 * Orders the block ids a location can anchor to, best first. A superseded diff
 * only ever anchors to its own new block: its neighbours describe a plan
 * revision the reader has already moved past, so following them would show the
 * change against unrelated content. That one candidate also carries the
 * result snapshot's content facts for the block, because the displayed
 * document was rendered from a later snapshot and the id alone cannot prove
 * the block still holds the content the diff is about.
 *
 * A location that brought its own complete rendering asks a different question
 * of the same id, and gets a different expectation. A lens built from recorded
 * text is only honest beside a block that still holds that text; a component
 * that carries `view` shows both of its own sides and reads the live block for
 * nothing, so the id is asking where to stand rather than what to say. Holding
 * such a location to the old text sends a change the plan still has a place for
 * into the historical archive at the foot of the document - a stop the stepper
 * still counts, with nothing to see where the reader is looking.
 *
 * It is still held to something, because a structural path is not an identity:
 * the same address can come to name an entirely different component, and
 * standing a historical card over one of those hides a live component behind a
 * record of something else. The kind is what the two questions have in common -
 * a component revised again is still the component the change was about, and a
 * component replaced by another is not - so that is what the id must still
 * name.
 */
export const lensAnchorCandidates = (
  location: DiffLocation,
  { isSuperseded }: { readonly isSuperseded: boolean },
): ReadonlyArray<LensAnchorCandidate> => {
  if (isSuperseded) {
    const carriesOwnRendering = location.view !== undefined;
    return location.newBlockId === undefined
      ? []
      : [
          {
            blockId: location.newBlockId,
            placement: "replace",
            ...(carriesOwnRendering
              ? { expectedKind: location.kind }
              : { expectedText: location.newText }),
            ...(!carriesOwnRendering &&
            location.newPresentation?.aspect === "image"
              ? { expectedPicture: location.newPresentation }
              : {}),
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
 * Whether a live block is still the kind of thing its candidate's id named.
 *
 * This is deliberately weaker than the text expectation beside it. It cannot
 * tell one table from another table at the same address, and it is not trying
 * to: it separates "the component this change was about, revised again" from
 * "some other component that inherited this structural path", which is the
 * distinction that decides whether a historical card may stand over a live
 * block at all.
 */
export const candidateMatchesLiveKind = ({
  candidate,
  liveKind,
}: {
  readonly candidate: LensAnchorCandidate;
  readonly liveKind: string | undefined;
}): boolean =>
  candidate.expectedKind === undefined || candidate.expectedKind === liveKind;

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
