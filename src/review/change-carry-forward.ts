// Owns moving a reviewer's verdicts onto a change set's new span when the
// thread that owns it commits another round.
//
// A change set is one evolving proposal, so its baseline stays put while its
// result advances. Its places do not survive that: a place id is minted under
// the bounds it was read at, so every place in the set is renamed the moment
// the next reply publishes, and the verdicts the reviewer recorded are left at
// an address no surface asks about any more. What the reviewer saw as "2 of 2
// accepted" comes back as "0 of 3", with the work they did nowhere in it.
//
// What survives a round is the block a change is about. Block ids are
// structural addresses, so a block keeps its address across an edit that does
// not move it, and that is the identity the stepper already follows across a
// round (see ./browser/tour-advance.ts). This applies the same rule to the
// record: a verdict moves onto the place that speaks for the same block.
//
// Carrying a verdict forward is not the same as claiming it still applies. The
// round that advanced the set may have rewritten the very change it was given
// for, so the row carries the digest of what it was decided over and the
// reading surfaces compare that with what is now in front of the reviewer. A
// carried verdict whose content moved reads as stale rather than as either a
// live decision or a change nobody has seen - which is the difference between
// telling the reviewer "this changed again" and quietly asking them to start
// over.
//
// The old rows are dropped rather than kept beside the new ones. They address a
// revision the set has left behind, nothing reads them, and leaving them would
// grow the record without bound while making "has this set been carried" a
// question nobody could answer cheaply.

import { basename, extname } from "node:path";
import { renderDocument } from "../render/render-document.js";
import { readChangeOwnership } from "./change-ownership.js";
import {
  changeSetsFrom,
  readCommittedRevisions,
  type CommittedPlanRevision,
} from "./change-set-commit.js";
import {
  updateStoredChangeVerdicts,
  validateChangeVerdicts,
  type StoredChangeVerdicts,
} from "./change-verdicts-store.js";
import { buildSnapshotDiff, type ChangeOwnership } from "./snapshot-diff.js";
import { readChangeVerdicts, readSnapshot, type ReviewStore } from "./store.js";
import type { DiffPlace, SnapshotDiff } from "./shared/review-wire.js";
import type { ChangeVerdict } from "./shared/change-verdict.js";

/** One change set whose recorded verdicts sit at a span it has moved past. */
type BehindSpan = {
  readonly changeSetId: string;
  readonly from: string;
  /** Where the record's rows are addressed. */
  readonly staleTo: string;
  /** Where the set now ends. */
  readonly currentTo: string;
};

/** The blocks one place speaks for, on either side of the change. */
const placeBlockIds = ({
  diff,
  place,
}: {
  readonly diff: SnapshotDiff;
  readonly place: DiffPlace;
}): ReadonlySet<string> =>
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
 * The verdicts of one advanced change set, re-addressed to its new span.
 *
 * Each decided place is matched to the place in the new diff that speaks for
 * one of its blocks. A place with no match decided a change the round removed,
 * so its verdict is dropped: there is nothing left for it to be about, and
 * keeping it would leave the set reporting progress against work that is gone.
 *
 * A new place that two old places both point at takes the first match in the
 * new diff's own order, so the result is the same however the record happens
 * to be ordered.
 */
export const carriedVerdicts = ({
  previous,
  next,
  decided,
}: {
  readonly previous: SnapshotDiff;
  readonly next: SnapshotDiff;
  readonly decided: ReadonlyArray<ChangeVerdict>;
}): ReadonlyArray<ChangeVerdict> => {
  const previousById = new Map(
    previous.places.map((place) => [place.placeId, place]),
  );
  const carried: Array<ChangeVerdict> = [];
  const claimed = new Set<string>();
  for (const entry of decided) {
    const before = previousById.get(entry.placeId);
    if (before === undefined) continue;
    const blockIds = placeBlockIds({ diff: previous, place: before });
    const match = next.places.find(
      (place) =>
        !claimed.has(place.placeId) &&
        [...placeBlockIds({ diff: next, place })].some((blockId) =>
          blockIds.has(blockId),
        ),
    );
    if (match === undefined) continue;
    claimed.add(match.placeId);
    carried.push({
      ...entry,
      to: next.to,
      placeId: match.placeId,
      // The digest stays the one the reviewer decided over. Replacing it with
      // the new place's would assert that they had seen this round's wording,
      // which is exactly the claim carrying a verdict forward must not make.
    });
  }
  return carried;
};

/**
 * Which change sets hold verdicts at a span they have moved past.
 *
 * A row is only a candidate when its bounds are a span this same change set
 * actually published: the set's own baseline, and a result some revision of
 * that set committed. Anything else at those bounds belongs to a surface that
 * is not the set's own diff - a comment's premise-to-current comparison, say -
 * and re-addressing it would move a verdict onto a change set that never
 * proposed it.
 */
export const spansBehind = ({
  revisions,
  verdicts,
}: {
  readonly revisions: ReadonlyArray<CommittedPlanRevision>;
  readonly verdicts: StoredChangeVerdicts;
}): ReadonlyArray<BehindSpan> => {
  const sets = new Map(
    changeSetsFrom(revisions).map((changeSet) => [
      changeSet.changeSetId,
      changeSet,
    ]),
  );
  const resultsBySet = new Map<string, Set<string>>();
  for (const revision of revisions) {
    for (const changeSetId of revision.changeSetIds) {
      const results = resultsBySet.get(changeSetId) ?? new Set<string>();
      results.add(revision.resultSnapshot);
      resultsBySet.set(changeSetId, results);
    }
  }
  const behind = new Map<string, BehindSpan>();
  for (const entry of verdicts.decided) {
    const changeSet = sets.get(entry.changeSetId);
    if (changeSet === undefined) continue;
    if (entry.from !== changeSet.baseSnapshot) continue;
    if (entry.to === changeSet.resultSnapshot) continue;
    if (resultsBySet.get(entry.changeSetId)?.has(entry.to) !== true) continue;
    behind.set(`${entry.changeSetId}:${entry.to}`, {
      changeSetId: entry.changeSetId,
      from: entry.from,
      staleTo: entry.to,
      currentTo: changeSet.resultSnapshot,
    });
  }
  return [...behind.values()];
};

const diffFor = async ({
  store,
  planPath,
  from,
  to,
  ownership,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly from: string;
  readonly to: string;
  readonly ownership: ChangeOwnership | undefined;
}): Promise<SnapshotDiff> => {
  const fallbackTitle = basename(planPath, extname(planPath));
  const [beforeSource, afterSource] = await Promise.all([
    readSnapshot({ store, snapshot: from }),
    readSnapshot({ store, snapshot: to }),
  ]);
  const blocksOf = (markdown: string) =>
    renderDocument({ markdown, fallbackTitle, identity: {} }).blocks;
  return buildSnapshotDiff({
    from,
    to,
    before: blocksOf(beforeSource),
    after: blocksOf(afterSource),
    ...(ownership === undefined ? {} : { ownership }),
  });
};

/**
 * Moves every verdict recorded at a superseded span onto the set's current one.
 *
 * The cheap question is asked first and answered from the record alone: a
 * review with nothing behind does no reading and no rendering, which is what
 * lets this run both eagerly at commit and again whenever the record is read,
 * so a decision made while a round was landing is not stranded by the race.
 *
 * A span whose snapshots or documents cannot be read is left exactly as it is.
 * Failing to carry a verdict costs the reviewer a re-decision they can see;
 * writing one from a diff this could not build would move it onto a change
 * nobody has looked at.
 */
export const carryForwardChangeVerdicts = async ({
  store,
  sessionId,
  planId,
  planPath,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly planPath: string;
}): Promise<void> => {
  let current: StoredChangeVerdicts;
  let revisions: ReadonlyArray<CommittedPlanRevision>;
  try {
    [current, revisions] = await Promise.all([
      readChangeVerdicts({ store, validate: validateChangeVerdicts }),
      readCommittedRevisions({ store }),
    ]);
  } catch {
    return;
  }
  if (spansBehind({ revisions, verdicts: current }).length === 0) return;
  const carriedBySpan = new Map<string, ReadonlyArray<ChangeVerdict>>();
  for (const span of spansBehind({ revisions, verdicts: current })) {
    const decided = current.decided.filter(
      (entry) =>
        entry.changeSetId === span.changeSetId &&
        entry.from === span.from &&
        entry.to === span.staleTo,
    );
    try {
      const [previousOwnership, nextOwnership] = await Promise.all([
        readChangeOwnership({
          store,
          sessionId,
          planId,
          from: span.from,
          to: span.staleTo,
        }),
        readChangeOwnership({
          store,
          sessionId,
          planId,
          from: span.from,
          to: span.currentTo,
        }),
      ]);
      const [previous, next] = await Promise.all([
        diffFor({
          store,
          planPath,
          from: span.from,
          to: span.staleTo,
          ownership: previousOwnership,
        }),
        diffFor({
          store,
          planPath,
          from: span.from,
          to: span.currentTo,
          ownership: nextOwnership,
        }),
      ]);
      carriedBySpan.set(
        `${span.changeSetId}:${span.staleTo}`,
        carriedVerdicts({ previous, next, decided }),
      );
    } catch {
      continue;
    }
  }
  if (carriedBySpan.size === 0) return;
  await updateStoredChangeVerdicts({
    store,
    change: (stored) => {
      // The record is re-read under its lock, so a verdict recorded between the
      // scan and the write is carried too when it sits at the same superseded
      // span, and left alone when it does not.
      const spans = spansBehind({ revisions, verdicts: stored }).filter(
        (span) => carriedBySpan.has(`${span.changeSetId}:${span.staleTo}`),
      );
      if (spans.length === 0) return stored;
      let decided = stored.decided;
      for (const span of spans) {
        const superseded = (entry: ChangeVerdict): boolean =>
          entry.changeSetId === span.changeSetId &&
          entry.from === span.from &&
          entry.to === span.staleTo;
        const carried =
          carriedBySpan.get(`${span.changeSetId}:${span.staleTo}`) ?? [];
        const carriedPlaceIds = new Set(carried.map((entry) => entry.placeId));
        decided = [
          ...decided.filter(
            (entry) =>
              !superseded(entry) &&
              // A place already decided at the current span keeps that answer:
              // the reviewer decided it after the round landed, so it is newer
              // than anything being carried onto it.
              !(
                entry.changeSetId === span.changeSetId &&
                entry.from === span.from &&
                entry.to === span.currentTo &&
                carriedPlaceIds.has(entry.placeId)
              ),
          ),
          ...carried,
        ];
      }
      return decided === stored.decided
        ? stored
        : { version: 1, revision: stored.revision + 1, decided };
    },
  });
};
