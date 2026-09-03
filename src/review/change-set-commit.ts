// The seam where Session Reliability hands the Change Engine a committed plan
// revision. Only a revision that crossed the fenced commit boundary is
// recorded here; an in-progress claim stage never is, so the change set can
// never describe bytes from an incomplete tool write.
//
// One durable record per committed request answers two questions. Read in
// commit order it is the revision log the reader's current snapshot advances
// from. Folded by change-set id, ordinary comment threads share a stable
// baseline across later replies, while every pushed-thread transaction keeps
// the immutable request-keyed identity it was committed with.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentResponse } from "./agent-exchange.js";
import { randomId, readStoreJson, writeStoreJson } from "./store.js";
import type { ReviewStore } from "./store.js";
import { CHANGE_SET_ID, SNAPSHOT_DIGEST } from "./shared/change-verdict.js";

const REQUEST_ID = /^[a-f0-9]{16}$/;
const COMMITTED_REVISION_VERSION = 1;

/**
 * What caused the change set a committed revision belongs to. Only an agent
 * proposes one, which is why the reviewer's own writes are absent here rather
 * than listed and then filtered: a change set with a reviewer's provenance is
 * a state the fold cannot reach.
 */
export type ChangeSetProvenance = "feedback" | "reply" | "chat" | "push";

/**
 * What caused the committed revision.
 *
 * The four change-set kinds name work an agent proposed. The last two name the
 * reviewer's own answer carried into the bytes, and they are two rather than
 * one because the gestures behind them end differently. `reject` takes some
 * places of a proposal back out while the rest of it stays under review.
 * `revert` takes a whole response back out, which leaves nothing of it to
 * review at all.
 */
export type PlanRevisionProvenance = ChangeSetProvenance | "reject" | "revert";

/** One published revision, addressed to the change sets it advances. */
export type CommittedPlanRevision = {
  readonly requestId: string;
  readonly changeSetIds: ReadonlyArray<string>;
  readonly baseSnapshot: string;
  readonly resultSnapshot: string;
  readonly provenance: PlanRevisionProvenance;
  readonly committedAt: string;
};

/** One change set as the committed revision log describes it. */
export type CommittedChangeSet = {
  readonly changeSetId: string;
  readonly provenance: ChangeSetProvenance;
  readonly baseSnapshot: string;
  readonly resultSnapshot: string;
  readonly committedAt: string;
};

export class CommittedRevisionRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommittedRevisionRejected";
  }
}

const revisionPath = ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): string => {
  if (!REQUEST_ID.test(requestId)) {
    throw new CommittedRevisionRejected(
      "A committed revision must name a 16 hexadecimal character request",
    );
  }
  return join(store.committedRevisionDirectory, `${requestId}.json`);
};

/**
 * Ordinary comment threads share one change set across replies. Plan-wide
 * questions, pushes, and replies in pushed threads are immutable transactions
 * addressed by their request ids.
 */
export const changeSetIdsFor = ({
  response,
  isPushedThread = false,
}: {
  readonly response: AgentResponse;
  readonly isPushedThread?: boolean;
}): ReadonlyArray<string> =>
  response.kind === "chat" ||
  response.kind === "push" ||
  response.kind === "approval" ||
  (response.kind === "reply" && isPushedThread)
    ? [response.requestId]
    : [...new Set(response.outcomes.map((outcome) => outcome.commentId))];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const validateRevision = (value: unknown): CommittedPlanRevision => {
  if (!isRecord(value) || value.version !== COMMITTED_REVISION_VERSION) {
    throw new CommittedRevisionRejected(
      "Unsupported committed revision version",
    );
  }
  const {
    requestId,
    changeSetIds,
    baseSnapshot,
    resultSnapshot,
    provenance,
    committedAt,
  } = value;
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) {
    throw new CommittedRevisionRejected("A committed revision needs a request");
  }
  if (
    !Array.isArray(changeSetIds) ||
    changeSetIds.length === 0 ||
    !changeSetIds.every(
      (id): id is string => typeof id === "string" && CHANGE_SET_ID.test(id),
    )
  ) {
    throw new CommittedRevisionRejected(
      "A committed revision needs at least one change set id",
    );
  }
  if (
    typeof baseSnapshot !== "string" ||
    !SNAPSHOT_DIGEST.test(baseSnapshot) ||
    typeof resultSnapshot !== "string" ||
    !SNAPSHOT_DIGEST.test(resultSnapshot)
  ) {
    throw new CommittedRevisionRejected(
      "A committed revision needs hexadecimal base and result snapshots",
    );
  }
  if (
    provenance !== "feedback" &&
    provenance !== "reply" &&
    provenance !== "chat" &&
    provenance !== "push" &&
    provenance !== "reject" &&
    provenance !== "revert"
  ) {
    throw new CommittedRevisionRejected(
      "A committed revision needs a known provenance",
    );
  }
  if (
    typeof committedAt !== "string" ||
    Number.isNaN(Date.parse(committedAt))
  ) {
    throw new CommittedRevisionRejected(
      "A committed revision needs an ISO commit time",
    );
  }
  return {
    requestId,
    changeSetIds,
    baseSnapshot,
    resultSnapshot,
    provenance,
    committedAt,
  };
};

/**
 * Records one published revision. Recovery replays the same commit, so writing
 * the record twice must describe the same revision rather than a second one.
 */
export const recordCommittedRevision = async ({
  store,
  revision,
}: {
  readonly store: ReviewStore;
  readonly revision: CommittedPlanRevision;
}): Promise<void> => {
  const stored = {
    version: COMMITTED_REVISION_VERSION,
    ...validateRevision({ version: COMMITTED_REVISION_VERSION, ...revision }),
  };
  await writeStoreJson({
    path: revisionPath({ store, requestId: revision.requestId }),
    value: stored,
  });
};

/**
 * Records the revision a reviewer's own decision published.
 *
 * Rejecting a change moves bytes, and until this existed the log never learned
 * it: the plan's digest stopped being any recorded revision's result, so the
 * chain from a thread's baseline to what the reader is looking at simply ended
 * there, and everything derived by walking that chain - which change set
 * declared which block, above all - was lost for every span crossing it.
 *
 * It is addressed by a fresh id rather than a request id because no request
 * made it. The change sets it names are the ones whose proposed content it took
 * back out, which is what lets a later reader say why the plan moved without
 * having to treat the reviewer's refusal as a proposal.
 */
export const recordRejectRevision = async ({
  store,
  changeSetIds,
  baseSnapshot,
  resultSnapshot,
  committedAt,
  provenance = "reject",
}: {
  readonly store: ReviewStore;
  readonly changeSetIds: ReadonlyArray<string>;
  readonly baseSnapshot: string;
  readonly resultSnapshot: string;
  readonly committedAt: string;
  /** `revert` only where the whole response was taken back out. */
  readonly provenance?: "reject" | "revert";
}): Promise<void> => {
  // A rejection that left the plan where it found it published nothing, and a
  // revision from a digest to itself would be a cycle in the chain.
  if (baseSnapshot === resultSnapshot) return;
  const named = changeSetIds.filter((id) => CHANGE_SET_ID.test(id));
  if (named.length === 0) return;
  await recordCommittedRevision({
    store,
    revision: {
      requestId: randomId(8),
      changeSetIds: named,
      baseSnapshot,
      resultSnapshot,
      provenance,
      committedAt,
    },
  });
};

const REVISION_FILE = /^([a-f0-9]{16})\.json$/;

/**
 * Reads the revisions a caller asks for, in commit order.
 *
 * The log is never pruned, so a request the caller will discard is never read:
 * the directory names carry the request id, and only the bodies that pass the
 * filter are opened. That is the whole reason `wanted` is asked before the
 * read rather than after it.
 */
const readRevisionsWhere = async ({
  store,
  wanted,
}: {
  readonly store: ReviewStore;
  readonly wanted: (requestId: string) => boolean;
}): Promise<ReadonlyArray<CommittedPlanRevision>> => {
  let names: ReadonlyArray<string>;
  try {
    names = await readdir(store.committedRevisionDirectory);
  } catch {
    return [];
  }
  const revisions: Array<CommittedPlanRevision> = [];
  for (const name of names) {
    const named = REVISION_FILE.exec(name);
    if (named === null) continue;
    const [, requestId] = named;
    if (requestId === undefined || !wanted(requestId)) continue;
    let value: unknown;
    try {
      value = JSON.parse(
        await readFile(join(store.committedRevisionDirectory, name), "utf8"),
      );
    } catch {
      continue;
    }
    try {
      revisions.push(validateRevision(value));
    } catch {
      // A record this build no longer understands is not a revision the
      // reader may be moved onto.
      continue;
    }
  }
  return revisions.sort((left, right) =>
    left.committedAt === right.committedAt
      ? left.requestId.localeCompare(right.requestId)
      : left.committedAt.localeCompare(right.committedAt),
  );
};

/** Reads the committed revision log in commit order. */
export const readCommittedRevisions = async ({
  store,
}: {
  readonly store: ReviewStore;
}): Promise<ReadonlyArray<CommittedPlanRevision>> =>
  readRevisionsWhere({ store, wanted: () => true });

/**
 * Reads only the revisions the caller is ready to move a reader onto.
 *
 * The browser polls the exchange every couple of seconds for the life of the
 * review, and the log grows by one file per answered request and is never
 * pruned. Folding all of it on every poll is the read-every-file pattern
 * BIG-44 removed from these routes, so the poll path names the ids it can act
 * on and reads nothing else.
 */
export const readCommittedRevisionsToObserve = async ({
  store,
  shouldObserve,
}: {
  readonly store: ReviewStore;
  readonly shouldObserve: (requestId: string) => boolean;
}): Promise<ReadonlyArray<CommittedPlanRevision>> =>
  readRevisionsWhere({ store, wanted: shouldObserve });

/**
 * Folds the revision log into change sets. The baseline and provenance come
 * from the change set's first committed revision and stay put, so a thread's
 * Was keeps naming where the thread started rather than where its latest
 * reply started.
 *
 * The reviewer's own writes are in the log for a reason the fold cannot
 * supply: the log is what says how the plan got from one digest to the next,
 * and a revision missing from that chain ends it at the point a reviewer
 * acted, taking every later span's ownership with it.
 *
 * Neither of them opens a change set. A change set is what an agent proposed,
 * and neither gesture proposes anything; opening one would ask the reviewer to
 * accept their own refusal.
 *
 * They differ in what they leave standing. A `reject` takes some places out
 * and leaves the rest of the proposal under review, so the set keeps ending
 * where the agent left it - advancing it would move the set past the very
 * places its own verdicts are addressed to, which is where an undo goes
 * looking for them. A `revert` takes a whole response back out, so the set
 * ends where that response started; when that is the set's own baseline it
 * proposes nothing any more, which is what stops approval from later accepting
 * a revision the plan no longer holds.
 */
export const changeSetsFrom = (
  revisions: ReadonlyArray<CommittedPlanRevision>,
): ReadonlyArray<CommittedChangeSet> => {
  const changeSets = new Map<string, CommittedChangeSet>();
  for (const revision of revisions) {
    for (const changeSetId of revision.changeSetIds) {
      const existing = changeSets.get(changeSetId);
      if (revision.provenance === "reject") continue;
      if (revision.provenance === "revert") {
        if (existing === undefined) continue;
        changeSets.set(changeSetId, {
          ...existing,
          resultSnapshot: revision.resultSnapshot,
          committedAt: revision.committedAt,
        });
        continue;
      }
      changeSets.set(changeSetId, {
        changeSetId,
        provenance: existing?.provenance ?? revision.provenance,
        baseSnapshot: existing?.baseSnapshot ?? revision.baseSnapshot,
        resultSnapshot: revision.resultSnapshot,
        committedAt: revision.committedAt,
      });
    }
  }
  return [...changeSets.values()];
};

/** Reads one plan's change sets as the committed revisions describe them. */
export const readCommittedChangeSets = async ({
  store,
}: {
  readonly store: ReviewStore;
}): Promise<ReadonlyArray<CommittedChangeSet>> =>
  changeSetsFrom(await readCommittedRevisions({ store }));

/** Reads one stored revision, or nothing when the request never committed. */
export const readCommittedRevision = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<CommittedPlanRevision | undefined> => {
  const value = await readStoreJson(revisionPath({ store, requestId }));
  if (value === undefined) return undefined;
  try {
    return validateRevision(value);
  } catch {
    return undefined;
  }
};
