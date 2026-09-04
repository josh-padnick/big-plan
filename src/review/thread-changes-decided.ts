// Answers one question the delete route has to ask before it removes a thread
// that already changed the plan: has the reviewer finished deciding what that
// thread proposed?
//
// Deleting such a thread is itself a verdict - everything still undecided is
// rejected, everything accepted stays - so the route must not accept a
// deletion that would leave a change nobody answered attached to a thread
// nobody can read any more. The browser records those rejections first and
// then asks for the deletion, and this is what proves it did.
//
// The proof is derived rather than remembered, exactly as the reject flow's is:
// the thread's change set names a baseline and a proposed revision, the places
// of that revision are read from the two sources, and the record is asked about
// each one. A thread whose change set cannot be resolved answers false, because
// an unprovable claim is not a proof.

import { basename, extname } from "node:path";
import { changedPlaces } from "./change-restore.js";
import { readCommittedChangeSets } from "./change-set-commit.js";
import { readChangeOwnership } from "./change-ownership.js";
import {
  changeDispositionOf,
  acceptedChangeKeys,
  decidedContentDigests,
  rejectedChangeKeys,
  type ChangeVerdictState,
} from "./shared/change-verdict.js";
import { readSnapshot } from "./store.js";
import type { ReviewStore } from "./store.js";

/**
 * Whether every change one thread proposed now carries a verdict.
 *
 * `changeSetId` is the thread's own id, which is what the committed revision
 * log folds an ordinary comment thread's rounds under.
 */
export const threadChangesAllDecided = async ({
  store,
  sessionId,
  planId,
  planPath,
  changeSetId,
  verdicts,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly planPath: string;
  readonly changeSetId: string;
  readonly verdicts: ChangeVerdictState;
}): Promise<boolean> => {
  const changeSet = (await readCommittedChangeSets({ store })).find(
    (candidate) => candidate.changeSetId === changeSetId,
  );
  if (changeSet === undefined) return false;
  const { baseSnapshot: from, resultSnapshot: to } = changeSet;
  let baselineSource: string;
  let proposedSource: string;
  try {
    [baselineSource, proposedSource] = await Promise.all([
      readSnapshot({ store, snapshot: from }),
      readSnapshot({ store, snapshot: to }),
    ]);
  } catch {
    // A snapshot this review no longer holds leaves the question unanswerable,
    // and an unanswerable question is not a yes.
    return false;
  }
  // The reader's own addresses, which means the reader's own grouping: a place
  // minted without the ownership partition is one no recorded verdict names.
  const ownership = await readChangeOwnership({
    store,
    sessionId,
    planId,
    from,
    to,
  });
  const places = changedPlaces({
    baselineSource,
    proposedSource,
    from,
    to,
    fallbackTitle: basename(planPath, extname(planPath)),
    ...(ownership === undefined ? {} : { ownership }),
  });
  if (places.length === 0) return false;
  const accepted = acceptedChangeKeys(verdicts);
  const rejected = rejectedChangeKeys(verdicts);
  const decidedDigests = decidedContentDigests(verdicts);
  return places.every((place) => {
    const disposition = changeDispositionOf({
        address: { changeSetId, from, to, placeId: place.placeId },
        accepted,
        rejected,
        decidedDigests,
        contentDigest: place.contentDigest,
      });
    return disposition !== "undecided" && disposition !== "stale";
  });
};
