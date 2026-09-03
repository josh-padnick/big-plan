// Owns which changes a reviewer accepts by resolving the thread they belong to.
//
// Resolving a thread is the reviewer saying the conversation is finished, and
// a change the thread proposed that nobody ever answered would otherwise sit
// open behind a closed thread - counted as outstanding work forever, and
// unreachable from the surface that would have decided it. So resolving
// answers them: every change the thread still leaves undecided is accepted.
//
// Only the undecided ones. A rejected change was already answered, and an
// accepted one was too, so the closure below names the thread's whole set and
// the shared ledger primitive keeps every verdict already recorded. That is
// also why this module records nothing itself: it selects places, and
// ./change-set-closure.js owns the one write that turns a selection into
// acceptances.
//
// The selection is thread-owned in exactly the sense the reading surface means
// it. A thread's span runs from the baseline its first committed reply started
// on to where its latest one left the plan, and inside that span the thread
// owns the places its replies attributed to blocks they declared changing.
// A reply that changed the plan without declaring targets cannot be attributed,
// so the whole span is taken rather than a guess at part of it - the same
// answer the digest gives when it stops offering a spillover count.

import { readAgentCommentHistory } from "./agent-exchange.js";
import type { AgentOutcome } from "./agent-exchange.js";
import {
  transactionSnapshotDiff,
  type ChangeSetClosure,
} from "./change-set-closure.js";
import { readCommittedChangeSets } from "./change-set-commit.js";
import { attributeDiffPlaces } from "./shared/change-attribution.js";
import {
  threadChangeSpanFor,
  threadChangeTargets,
} from "./shared/thread-change-set.js";
import type { ReviewStore } from "./store.js";

/** The change targets every committed reply in this thread declared. */
const declaredChangeTargets = ({
  responses,
  commentId,
}: {
  readonly responses: ReadonlyArray<{
    readonly kind: string;
    readonly outcomes?: ReadonlyArray<AgentOutcome>;
  }>;
  readonly commentId: string;
}): ReadonlyArray<string> | undefined =>
  threadChangeTargets(
    responses
      .flatMap((response) => response.outcomes ?? [])
      .filter(
        (outcome) =>
          outcome.commentId === commentId && outcome.state === "changed",
      )
      .map((outcome) => outcome.changeTargets),
  );

/**
 * The places each newly resolved thread owns, ready for one ledger write.
 *
 * A thread that has committed nothing, or whose span moved the plan nowhere,
 * contributes no closure: resolving it decides nothing because it proposed
 * nothing.
 */
export const closuresForResolvedThreads = async ({
  store,
  planPath,
  sessionId,
  planId,
  commentIds,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly commentIds: ReadonlyArray<string>;
}): Promise<ReadonlyArray<ChangeSetClosure>> => {
  if (commentIds.length === 0) return [];
  const changeSets = await readCommittedChangeSets({ store });
  const closures: Array<ChangeSetClosure> = [];
  for (const commentId of commentIds) {
    const exchange = await readAgentCommentHistory({
      store,
      sessionId,
      planId,
      commentId,
    });
    const span = threadChangeSpanFor({
      changeSets,
      commentId,
      requestIds: exchange.requests.map((request) => request.requestId),
    });
    if (span === undefined) continue;
    const diff = await transactionSnapshotDiff({
      store,
      sessionId,
      planId,
      planPath,
      from: span.from,
      to: span.to,
    });
    if (diff === undefined) continue;
    const changeTargets = declaredChangeTargets({
      responses: exchange.responses,
      commentId,
    });
    const owned =
      changeTargets === undefined
        ? new Set(diff.places.map((place) => place.placeId))
        : new Set(
            attributeDiffPlaces({
              diff,
              changeTargets,
              changeSetId: commentId,
            }).placeIds,
          );
    // The content each place holds travels with it, so a resolve that closed a
    // change can still say what it closed when a later round rewrites it.
    const places = diff.places.filter((place) => owned.has(place.placeId));
    if (places.length === 0) continue;
    // A thread's change set is keyed by the comment it grew from, so that is
    // the owner every verdict this resolve records is addressed to.
    closures.push({
      changeSetId: commentId,
      from: span.from,
      to: span.to,
      places: places.map((place) => ({
        placeId: place.placeId,
        contentDigest: place.contentDigest,
      })),
    });
  }
  return closures;
};
