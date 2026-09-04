// Decides when the open change-set tour is showing an earlier round of the set
// it belongs to, so the floating stepper follows the thread it was opened from
// instead of holding the diff that existed when the reviewer opened it, and
// which change of the advanced set the reviewer was already standing on.

import type { DiffPlace, SnapshotDiff } from "../shared/review-wire.js";

/**
 * Which comparison of a thread a tour is showing.
 *
 * A thread can hold two at once: the revision its agent proposed, and - once
 * the plan moves past the comment - the difference between the plan the
 * reviewer wrote against and the plan as it now reads. They answer different
 * questions and advance on different clocks.
 */
export type ChangeSetTourKind = "changes" | "premise";

/**
 * The identity of one comparison, for the tour that shows it.
 *
 * Identifying a comparison by its thread alone is not enough, because a thread
 * can hold both of them. Two cards passing the same id with different bounds
 * each read the other's tour as their own set gone stale, so each re-opens the
 * tour with its own diff and the two take the screen from each other on every
 * poll - which is what the reviewer sees as the bar flickering between
 * "Reviewing change set" and "Since your comment" while they touch nothing.
 * Minting the id here, from both facts, is what makes that collision
 * unrepresentable rather than merely unlikely.
 */
export const changeSetTourId = ({
  threadId,
  kind,
}: {
  readonly threadId: string;
  readonly kind: ChangeSetTourKind;
}): string => `${threadId}:${kind}`;

/**
 * Whether the open tour is behind the comparison given here.
 *
 * A thread owns one change set whose result advances as replies commit, so the
 * bounds the bar holds go stale the moment the next reply publishes. The
 * comparison is matched by the tour it belongs to rather than by its bounds
 * alone: two threads opened against the same plan state share a baseline, so
 * bounds alone would move the reviewer onto another thread's change.
 */
export const tourIsBehind = ({
  activeTourId,
  activeDiff,
  tourId,
  diff,
}: {
  readonly activeTourId: string | null;
  readonly activeDiff: { readonly from: string; readonly to: string } | null;
  readonly tourId: string | undefined;
  readonly diff: { readonly from: string; readonly to: string } | null;
}): boolean =>
  tourId !== undefined &&
  activeTourId === tourId &&
  activeDiff !== null &&
  diff !== null &&
  (activeDiff.from !== diff.from || activeDiff.to !== diff.to);

/** The blocks one place speaks for, on either side of the change. */
const placeBlockIds = (
  diff: SnapshotDiff,
  place: DiffPlace,
): ReadonlySet<string> =>
  new Set(
    place.locationIndexes.flatMap((index) => {
      const location = diff.locations.at(index);
      if (location === undefined) return [];
      return [location.newBlockId, location.oldBlockId].filter(
        (blockId): blockId is string => blockId !== undefined,
      );
    }),
  );

/**
 * Which change of the advanced set continues the one the stepper was showing.
 *
 * A place id is keyed by the bounds it was minted under, so every place is
 * renamed the moment the set's result advances, and following the id would
 * drop the reviewer back at the set's first change. What survives a round is
 * the block the change is about: block ids are structural addresses, so a
 * block keeps its address across an edit that does not move it. Nothing else
 * identifies a change well enough to move the reviewer onto it - a label is
 * summarized content, shared by siblings and rewritten by the very round being
 * followed - so a change with no block in common answers with nothing, and the
 * tour lands at the start of the set as it does when it is opened afresh.
 */
export const advancedTourPlaceId = ({
  activeDiff,
  activePlaceId,
  diff,
  placeIds,
}: {
  readonly activeDiff: SnapshotDiff | null;
  readonly activePlaceId: string | null;
  readonly diff: SnapshotDiff;
  readonly placeIds: ReadonlyArray<string>;
}): string | undefined => {
  const active =
    activeDiff === null || activePlaceId === null
      ? undefined
      : activeDiff.places.find((place) => place.placeId === activePlaceId);
  if (activeDiff === null || active === undefined) return undefined;
  const allowed = new Set(placeIds);
  const candidates = diff.places.filter((place) => allowed.has(place.placeId));
  const blockIds = placeBlockIds(activeDiff, active);
  return candidates.find((place) =>
    [...placeBlockIds(diff, place)].some((blockId) => blockIds.has(blockId)),
  )?.placeId;
};
