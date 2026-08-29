// Owns the join between one comment thread and the committed change set that
// thread owns: which set a thread's requests belong to, and which of the
// thread's own blocks that set is allowed to be attributed to.
//
// A thread's change set is one evolving proposal, not one diff per reply. The
// runtime already folds it that way - the baseline stays where the thread's
// first committed revision put it while the result advances - so the reading
// surface only has to name the right set and read it whole. Naming it is the
// part that needs a decision: an ordinary feedback thread's set is keyed by
// the comment it grew from, while a pushed thread's transaction is keyed by
// the request that opened it, and only the thread knows which it is.

import type { CommittedChangeSet } from "./review-wire.js";
import type {
  ProjectedThreadExchange,
  ThreadRequest,
  ThreadResponse,
} from "./thread-projection.js";
import type { AgentModelIdentity } from "./agent-model.js";

/** The plan span a thread's committed work covers, baseline to result. */
export type ThreadChangeSpan = {
  readonly from: string;
  readonly to: string;
};

/**
 * The span every change set this thread owns adds up to, or `undefined` while
 * the thread has committed nothing.
 *
 * The comment id is tried first because it is the identity an ordinary thread
 * keeps across every reply; the request ids are the fallback that finds the
 * immutable transactions - pushed threads and chat - whose sets are keyed by
 * the request that opened them. A thread that committed under more than one of
 * those ids is still proposing one change, so the sets are read as one span:
 * it starts where the thread's earliest committed revision started and ends
 * where its latest one left the plan.
 */
export const threadChangeSpanFor = ({
  changeSets,
  commentId,
  requestIds,
}: {
  readonly changeSets: ReadonlyArray<CommittedChangeSet>;
  readonly commentId: string;
  readonly requestIds: ReadonlyArray<string>;
}): ThreadChangeSpan | undefined => {
  const owned = [...changeSets]
    .filter(
      (changeSet) =>
        changeSet.changeSetId === commentId ||
        requestIds.includes(changeSet.changeSetId),
    )
    .sort((left, right) => left.committedAt.localeCompare(right.committedAt));
  const earliest = owned.at(0);
  const latest = owned.at(-1);
  if (earliest === undefined || latest === undefined) return undefined;
  return { from: earliest.baseSnapshot, to: latest.resultSnapshot };
};

/**
 * Every block this thread's committed replies have reported changing.
 *
 * One aggregate change set spans every reply that built it, so the places it
 * may be attributed to are the union of what those replies touched. Reading
 * only the last reply's targets would hide the earlier rounds' places behind a
 * spillover count, which is exactly the per-response view this replaces.
 */
export const threadChangeTargets = (
  changeTargets: ReadonlyArray<ReadonlyArray<string> | undefined>,
): ReadonlyArray<string> | undefined => {
  const declared = changeTargets.filter(
    (targets): targets is ReadonlyArray<string> => targets !== undefined,
  );
  // A reply that changed the plan without declaring targets cannot be
  // attributed, and guessing from its siblings would credit its places to
  // blocks it never named. The whole set stays unattributed instead, which is
  // also the honest answer when there is nothing to attribute from.
  if (declared.length !== changeTargets.length) return undefined;
  const targets = [...new Set(declared.flat())];
  return targets.length === 0 ? undefined : targets;
};

/** The one diff a thread with committed work shows, and where it belongs. */
export type ThreadChange = {
  /** The reply the change set is rendered beside: the thread's latest. */
  readonly requestId: string;
  /** The thread's baseline: the plan before this thread proposed anything. */
  readonly from: string;
  /** The thread's result: the plan as its committed replies leave it. */
  readonly to: string;
  readonly agentIdentity?: AgentModelIdentity;
  readonly changeTargets?: ReadonlyArray<string>;
};

/**
 * The single change a thread is proposing, folded from every reply that has
 * committed one, or `undefined` while the thread has changed nothing.
 *
 * The committed fold owns the baseline, because it is the only party that
 * knows where the thread's first committed revision started; the thread's own
 * first changed reply answers for it until the fold has been read, so a diff
 * appears with the reply rather than after a round trip.
 *
 * The result is taken from the thread's latest committed reply whenever the
 * plan still stands on it. That keeps the rendered diff equal to what the
 * reader is looking at during the moment between a reply landing and the fold
 * being re-read, when the fold still describes the previous round.
 */
export const threadChangeFor = ({
  changeSets,
  commentId,
  exchanges,
  currentSnapshot,
}: {
  readonly changeSets: ReadonlyArray<CommittedChangeSet>;
  readonly commentId: string;
  readonly exchanges: ReadonlyArray<
    ProjectedThreadExchange<ThreadRequest, ThreadResponse>
  >;
  readonly currentSnapshot: string;
}): ThreadChange | undefined => {
  const changed = exchanges.filter(
    (exchange) =>
      exchange.outcome?.state === "changed" && exchange.response !== undefined,
  );
  const first = changed.at(0);
  const latest = changed.at(-1);
  if (first === undefined || latest?.response === undefined) return undefined;
  const committed = threadChangeSpanFor({
    changeSets,
    commentId,
    requestIds: exchanges.map((exchange) => exchange.request.requestId),
  });
  const latestResult = latest.response.resultSnapshot;
  const changeTargets = threadChangeTargets(
    changed.map((exchange) => exchange.outcome?.changeTargets),
  );
  return {
    requestId: latest.request.requestId,
    from: committed?.from ?? first.baselineSnapshot,
    to:
      committed === undefined || latestResult === currentSnapshot
        ? latestResult
        : committed.to,
    ...(latest.request.claimedModel === undefined
      ? {}
      : { agentIdentity: latest.request.claimedModel }),
    ...(changeTargets === undefined ? {} : { changeTargets }),
  };
};
