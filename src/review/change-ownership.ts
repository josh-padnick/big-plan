// Owns the join that says which change set declared each changed block inside
// one revision span, so the diff can group by ownership instead of by
// adjacency alone.
//
// The revision line is shared and totally ordered, so a thread's span is
// routinely a superset of another thread's revision: the moment a second
// thread commits between two rounds of a first, the first thread's diff
// replays the second thread's edit. Grouping that runs on adjacency alone then
// merges the two into one review stop, and one review stop is one acceptance
// address - which is how one thread's acceptance closes another thread's work
// with nothing said. Naming the owner of each block is what lets the diff keep
// them apart.
//
// Both halves are derived, never remembered. The committed revision log says
// which change sets each published revision advanced; the agent's own response
// says which blocks it changed for which comment. Nothing here invents an
// owner: a block two change sets both declared has no single owner and is left
// unowned, because guessing one would attribute another thread's work exactly
// as confidently as the defect this exists to remove.

import { readAgentResponsesFor } from "./agent-exchange.js";
import type { AgentResponse } from "./agent-exchange.js";
import { readCommittedRevisions } from "./change-set-commit.js";
import type { CommittedPlanRevision } from "./change-set-commit.js";
import type { ChangeOwnership } from "./snapshot-diff.js";
import type { ReviewStore } from "./store.js";

/** A block claimed by more than one change set, so it is claimed by none. */
const CONTESTED = Symbol("contested");

/**
 * The committed revisions the span from `from` to `to` is made of, oldest
 * first, or an empty list when the log holds no chain between the two.
 *
 * It walks back from the result rather than filtering by commit time because
 * the span is a chain of bytes, not an interval on a clock: a revision that
 * committed inside the same window but on a digest this chain never passed
 * through did not contribute to what the diff shows.
 */
export const revisionChainFor = ({
  revisions,
  from,
  to,
}: {
  readonly revisions: ReadonlyArray<CommittedPlanRevision>;
  readonly from: string;
  readonly to: string;
}): ReadonlyArray<CommittedPlanRevision> => {
  const byResult = new Map<string, CommittedPlanRevision>();
  for (const revision of revisions) {
    // A digest reached twice was published twice with the same bytes. The
    // earliest arrival is the one the later revisions were built on.
    const seen = byResult.get(revision.resultSnapshot);
    if (seen === undefined || revision.committedAt < seen.committedAt) {
      byResult.set(revision.resultSnapshot, revision);
    }
  }
  const chain: Array<CommittedPlanRevision> = [];
  let cursor = to;
  while (cursor !== from) {
    const revision = byResult.get(cursor);
    if (revision === undefined) return [];
    chain.push(revision);
    cursor = revision.baseSnapshot;
    // A log that loops back on itself would never reach the baseline. The
    // chain can hold each revision only once, so its own length is the bound.
    if (chain.length > byResult.size) return [];
  }
  return chain.reverse();
};

/**
 * Which change set declared each block changed inside one revision span.
 *
 * A revision whose log entry names exactly its own request is an immutable
 * transaction - chat, a push, a reply inside a pushed thread - and everything
 * it changed belongs to that one set. Every other revision answers per
 * outcome, because one feedback response can answer several comment threads at
 * once and each of those threads owns only the blocks its own outcome named.
 */
export const changeOwnershipFrom = ({
  revisions,
  responses,
  from,
  to,
}: {
  readonly revisions: ReadonlyArray<CommittedPlanRevision>;
  readonly responses: ReadonlyArray<AgentResponse>;
  readonly from: string;
  readonly to: string;
}): ChangeOwnership => {
  const responseFor = new Map(
    responses.map((response) => [response.requestId, response]),
  );
  const claims = new Map<string, string | typeof CONTESTED>();
  const claim = ({
    blockId,
    changeSetId,
  }: {
    readonly blockId: string;
    readonly changeSetId: string;
  }): void => {
    const held = claims.get(blockId);
    if (held === undefined) {
      claims.set(blockId, changeSetId);
      return;
    }
    if (held !== changeSetId) claims.set(blockId, CONTESTED);
  };
  for (const revision of revisionChainFor({ revisions, from, to })) {
    const response = responseFor.get(revision.requestId);
    if (response === undefined || !("outcomes" in response)) continue;
    const isTransaction =
      revision.changeSetIds.length === 1 &&
      revision.changeSetIds[0] === revision.requestId;
    for (const outcome of response.outcomes) {
      const changeSetId = isTransaction
        ? revision.requestId
        : outcome.commentId;
      // A revision that advanced a set the log never recorded cannot be
      // attributed to it; the log is the authority on what was published.
      if (!isTransaction && !revision.changeSetIds.includes(changeSetId)) {
        continue;
      }
      for (const blockId of outcome.changeTargets ?? []) {
        claim({ blockId, changeSetId });
      }
    }
  }
  const ownership = new Map<string, string>();
  for (const [blockId, held] of claims) {
    if (held !== CONTESTED) ownership.set(blockId, held);
  }
  return ownership;
};

/**
 * The ownership partition for one span, read from the store.
 *
 * Every surface that mints place ids for a span has to read the same partition
 * as the reader's diff, because a place id is the acceptance address: the
 * reader's diff, the auto-accept closure, approval's count, and the source
 * restore all group the same revision and must group it the same way. A span
 * with no reconstructible chain, or nothing declared inside it, answers
 * `undefined`, which is grouping by adjacency alone - the same answer every
 * one of those surfaces gives.
 */
export const readChangeOwnership = async ({
  store,
  sessionId,
  planId,
  from,
  to,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly from: string;
  readonly to: string;
}): Promise<ChangeOwnership | undefined> => {
  const revisions = await readCommittedRevisions({ store });
  const chain = revisionChainFor({ revisions, from, to });
  if (chain.length === 0) return undefined;
  const responses = await readAgentResponsesFor({
    store,
    sessionId,
    planId,
    requestIds: new Set(chain.map((revision) => revision.requestId)),
  });
  const ownership = changeOwnershipFrom({ revisions, responses, from, to });
  return ownership.size === 0 ? undefined : ownership;
};
