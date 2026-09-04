// Owns what a destructive review action says the reviewer is about to lose.
// Rejecting a change takes content the agent wrote back out of the plan and
// the review cannot recover it, so a dialog that is about to do that leads
// with the loss and then shows the content itself, grouped by the slide it
// lives on and reachable by opening that slide.
//
// There is deliberately no vocabulary of content kinds here: a reviewer thinks
// in slides and in what is written on them, and a name invented for a category
// of block would be one more thing to learn before understanding what a button
// is about to delete.
//
// The projection is addressed by places rather than by the whole revision,
// because the reviewer's decisions have already split the revision in two. A
// thread deletion rejects what is still undecided and leaves what was
// accepted, so the only honest list is the one drawn over the places that are
// actually going.

import type { DiffLocation, DiffPlace, SnapshotDiff } from "./review-wire.js";

/** The one sentence the delete-thread confirmation leads with. */
export const THREAD_DELETE_LEAD_LINE =
  "Deleting this thread permanently removes it, and permanently deletes the following content from the plan. This cannot be undone.";

/** What the confirmation says about the changes the reviewer already accepted. */
export const THREAD_DELETE_ACCEPTED_NOTE =
  "Changes you already accepted stay in the plan.";

/**
 * How much of a block's text stands in for it under an opened slide.
 *
 * Long enough to recognize the passage, short enough that a slide with several
 * changes still reads as a list of things going rather than as the plan
 * reprinted inside a dialog.
 */
export const EXCERPT_LIMIT = 140;

export type BoundedText = {
  readonly text: string;
  /** Whether the text stops short of the content it stands for. */
  readonly isExcerpt: boolean;
};

/** Bounds text for a preview, marking it when it stops short. */
export const boundPreviewText = (
  raw: string,
  limit: number = EXCERPT_LIMIT,
): BoundedText => {
  const collapsed = raw.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= limit) {
    return { text: collapsed, isExcerpt: false };
  }
  // Cut at the last word boundary inside the bound, so a preview never ends
  // mid-word and reads as a broken string rather than a shortened sentence.
  const cut = collapsed.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return {
    text: `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`,
    isExcerpt: true,
  };
};

export type PlanLossImage = {
  readonly source: string;
  readonly alt: string;
};

export type PlanLossPreview =
  | { readonly shape: "image"; readonly image: PlanLossImage }
  | { readonly shape: "text"; readonly excerpt: BoundedText };

export type PlanSlideLoss = {
  /** The slide's scope, which is also this row's identity. */
  readonly scope: string;
  /** The slide's title, as the diff records it. */
  readonly title: string;
  /**
   * A block id on this slide, so the dialog can find the live slide and read
   * the chrome and content the reader is looking at right now.
   */
  readonly anchorBlockId: string | undefined;
  /** How many places on this slide the action takes back. */
  readonly changeCount: number;
  /** What the action deletes here, in document order. */
  readonly previews: ReadonlyArray<PlanLossPreview>;
};

/** The image a location carries, on whichever side of the change has one. */
const imageOf = (location: DiffLocation): PlanLossImage | undefined => {
  if (location.status === "removed") return undefined;
  const presentation = location.newPresentation ?? location.oldPresentation;
  return presentation?.aspect === "image"
    ? { source: presentation.source, alt: presentation.alt }
    : undefined;
};

/**
 * The words a location contributes to the list.
 *
 * Rejecting deletes what the plan holds now, so the new text is what the
 * reviewer is about to lose. A removal has none, and its old text is what
 * comes back rather than what goes, so it contributes nothing here.
 */
const textOf = (location: DiffLocation): string =>
  location.status === "removed" ? "" : location.newText;

const blockIdOf = (location: DiffLocation): string | undefined =>
  location.newBlockId ?? location.oldBlockId;

/**
 * What rejecting the named places removes, grouped by the slide it sits on.
 *
 * Naming no places projects the whole revision, because a caller with nothing
 * to narrow by is asking about everything the revision proposed rather than
 * about nothing at all.
 */
export const projectPlanLoss = ({
  diff,
  placeIds,
}: {
  readonly diff: SnapshotDiff;
  readonly placeIds?: ReadonlyArray<string>;
}): ReadonlyArray<PlanSlideLoss> => {
  const wanted = placeIds === undefined ? undefined : new Set(placeIds);
  const places: ReadonlyArray<DiffPlace> =
    wanted === undefined
      ? diff.places
      : diff.places.filter((place) => wanted.has(place.placeId));
  const slides = new Map<
    string,
    {
      scope: string;
      title: string;
      anchorBlockId: string | undefined;
      changeCount: number;
      previews: PlanLossPreview[];
      seenText: Set<string>;
    }
  >();
  for (const place of places) {
    for (const index of place.locationIndexes) {
      const location = diff.locations.at(index);
      if (location === undefined) continue;
      const scope = location.scope;
      const slide = slides.get(scope) ?? {
        scope,
        title: place.section === "" ? location.section : place.section,
        anchorBlockId: undefined,
        changeCount: 0,
        previews: [],
        seenText: new Set<string>(),
      };
      slide.anchorBlockId ??= blockIdOf(location);
      const image = imageOf(location);
      if (image !== undefined) {
        slide.previews.push({ shape: "image", image });
      } else {
        const excerpt = boundPreviewText(textOf(location));
        // A component's root and its fields both name the same words, so the
        // same passage can arrive several times over. Showing it once keeps
        // the list a list of things being deleted rather than of diff rows.
        if (excerpt.text !== "" && !slide.seenText.has(excerpt.text)) {
          slide.seenText.add(excerpt.text);
          slide.previews.push({ shape: "text", excerpt });
        }
      }
      slides.set(scope, slide);
    }
    const scopes = new Set(
      place.locationIndexes.flatMap((index) => {
        const location = diff.locations.at(index);
        return location === undefined ? [] : [location.scope];
      }),
    );
    for (const scope of scopes) {
      const slide = slides.get(scope);
      if (slide !== undefined) slide.changeCount += 1;
    }
  }
  return [...slides.values()].map(
    ({ scope, title, anchorBlockId, changeCount, previews }) => ({
      scope,
      title,
      anchorBlockId,
      changeCount,
      previews,
    }),
  );
};

/** How many places the action takes back, across every affected slide. */
export const planLossChangeCount = (
  slides: ReadonlyArray<PlanSlideLoss>,
): number => slides.reduce((total, slide) => total + slide.changeCount, 0);
