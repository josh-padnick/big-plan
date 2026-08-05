// Owns durable reviewer-state loading, optimistic saves, sent-history
// reconciliation, and recoverable feedback commits.

import type { ReviewComment } from "./comment.js";
import type { FeedbackPackage } from "./feedback-package.js";
import {
  readAgentExchange,
  writeAgentRequest,
  type AgentExchangeSnapshot,
  type AgentRequest,
} from "./agent-exchange.js";
import {
  appendProgress,
  readMutableJson,
  writeFeedbackPackage,
  writeMutableJson,
  writeRevisionSnapshot,
  type ReviewStore,
  type ProgressEvent,
} from "./store.js";

export type ReviewerStateSnapshot = {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly activeDraft: string;
  readonly resolvedCommentIds: ReadonlyArray<string>;
};

export type DurableReview = {
  readonly reviewer: ReviewerStateSnapshot;
  readonly exchange: AgentExchangeSnapshot;
  readonly sent: ReadonlyArray<ReviewComment>;
};

export class ReviewerStateCorrupt extends Error {
  constructor(path: string) {
    super(
      `The durable reviewer state is corrupt at ${path}. Preserve the file and restore or remove it explicitly before reopening this review.`,
    );
    this.name = "ReviewerStateCorrupt";
  }
}

type ReviewerValidators = {
  readonly drafts: (value: unknown) => ReadonlyArray<ReviewComment>;
  readonly activeDraft: (value: unknown) => string;
  readonly resolvedCommentIds: (value: unknown) => ReadonlyArray<string>;
};

const emptyReviewerState = (): ReviewerStateSnapshot => ({
  schemaVersion: 1,
  revision: 0,
  drafts: [],
  activeDraft: "",
  resolvedCommentIds: [],
});

/** Validates the authoritative mutable snapshot as one coherent value. */
const reviewerState = ({
  value,
  validators,
  path,
}: {
  readonly value: unknown;
  readonly validators: ReviewerValidators;
  readonly path: string;
}): ReviewerStateSnapshot => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("revision" in value) ||
    typeof value.revision !== "number" ||
    !Number.isInteger(value.revision) ||
    value.revision < 0 ||
    !("drafts" in value) ||
    !("activeDraft" in value) ||
    !("resolvedCommentIds" in value)
  ) {
    throw new ReviewerStateCorrupt(path);
  }
  try {
    return {
      schemaVersion: 1,
      revision: value.revision,
      drafts: validators.drafts(value.drafts),
      activeDraft: validators.activeDraft(value.activeDraft),
      resolvedCommentIds: validators.resolvedCommentIds(
        value.resolvedCommentIds,
      ),
    };
  } catch {
    throw new ReviewerStateCorrupt(path);
  }
};

/** Loads a missing snapshot as revision zero and rejects invalid authority. */
export const loadReviewerState = async ({
  store,
  validators,
}: {
  readonly store: ReviewStore;
  readonly validators: ReviewerValidators;
}): Promise<ReviewerStateSnapshot> => {
  const stored = await readMutableJson({ path: store.reviewerStatePath });
  if (stored.kind === "missing") return emptyReviewerState();
  if (stored.kind === "invalid") {
    throw new ReviewerStateCorrupt(store.reviewerStatePath);
  }
  return reviewerState({
    value: stored.value,
    validators,
    path: store.reviewerStatePath,
  });
};

const saveQueues = new Map<string, Promise<void>>();

/** Serializes one optimistic reviewer mutation against the current revision. */
export const saveReviewerState = async ({
  store,
  expectedRevision,
  next,
  validators,
}: {
  readonly store: ReviewStore;
  readonly expectedRevision: number;
  readonly next: Omit<ReviewerStateSnapshot, "schemaVersion" | "revision">;
  readonly validators: ReviewerValidators;
}): Promise<
  | { readonly ok: true; readonly snapshot: ReviewerStateSnapshot }
  | { readonly ok: false; readonly current: ReviewerStateSnapshot }
> => {
  const previous = saveQueues.get(store.reviewerStatePath) ?? Promise.resolve();
  let release = (): void => undefined;
  const currentTurn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => currentTurn);
  saveQueues.set(store.reviewerStatePath, queued);
  await previous;
  try {
    const current = await loadReviewerState({ store, validators });
    if (current.revision !== expectedRevision) {
      return { ok: false, current };
    }
    const snapshot = reviewerState({
      value: {
        schemaVersion: 1,
        revision: current.revision + 1,
        ...next,
      },
      validators,
      path: store.reviewerStatePath,
    });
    await writeMutableJson({ path: store.reviewerStatePath, value: snapshot });
    return { ok: true, snapshot };
  } finally {
    release();
    if (saveQueues.get(store.reviewerStatePath) === queued) {
      saveQueues.delete(store.reviewerStatePath);
    }
  }
};

/** Loads one reconciled review and derives sent comments from request facts. */
export const loadDurableReview = async ({
  store,
  sessionId,
  planId,
  validators,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly validators: ReviewerValidators;
}): Promise<DurableReview> => {
  const [reviewer, exchange] = await Promise.all([
    loadReviewerState({ store, validators }),
    readAgentExchange({ store, sessionId, planId }),
  ]);
  const sentById = new Map<string, ReviewComment>();
  for (const request of exchange.requests) {
    if (request.kind !== "feedback") continue;
    for (const comment of request.comments) sentById.set(comment.id, comment);
  }
  const sent = [...sentById.values()];
  const sentIds = new Set(sentById.keys());
  return {
    reviewer: {
      ...reviewer,
      drafts: reviewer.drafts.filter((draft) => !sentIds.has(draft.id)),
    },
    exchange,
    sent,
  };
};

export type CommitFeedbackResult =
  | {
      readonly ok: true;
      readonly snapshot: ReviewerStateSnapshot;
      readonly package: {
        readonly jsonPath: string;
        readonly briefPath: string;
      };
    }
  | { readonly ok: false; readonly current: ReviewerStateSnapshot };

export type ReviewEvent = Omit<ProgressEvent, "eventId" | "seq"> & {
  readonly eventId: string;
};

export type CommitFeedbackCheckpoint =
  | "feedback-package"
  | "source-revision"
  | "agent-requests"
  | "reviewer-state"
  | "review-event";

/** Publishes one immutable runtime-authored activity fact. */
export const publishReviewEvent = async ({
  store,
  event,
}: {
  readonly store: ReviewStore;
  readonly event: ReviewEvent;
}): Promise<void> => appendProgress({ store, event });

const requestsAlreadyCommitted = ({
  requests,
  exchange,
}: {
  readonly requests: ReadonlyArray<AgentRequest>;
  readonly exchange: AgentExchangeSnapshot;
}): boolean => {
  const committedIds = new Set(
    exchange.requests.map((request) => request.requestId),
  );
  return requests.every((request) => committedIds.has(request.requestId));
};

/** Commits immutable feedback facts before removing submitted draft ownership. */
export const commitFeedback = async ({
  store,
  expectedRevision,
  feedback,
  brief,
  source,
  sourceRevision,
  requests,
  submittedCommentIds,
  event,
  validators,
  testingCheckpoint,
}: {
  readonly store: ReviewStore;
  readonly expectedRevision: number;
  readonly feedback: FeedbackPackage;
  readonly brief: string;
  readonly source: string;
  readonly sourceRevision: string;
  readonly requests: ReadonlyArray<AgentRequest>;
  readonly submittedCommentIds: ReadonlyArray<string>;
  readonly event: ReviewEvent;
  readonly validators: ReviewerValidators;
  readonly testingCheckpoint?: (
    checkpoint: CommitFeedbackCheckpoint,
  ) => Promise<void>;
}): Promise<CommitFeedbackResult> => {
  const initial = await loadDurableReview({
    store,
    sessionId: feedback.sessionId,
    planId: feedback.planId,
    validators,
  });
  if (initial.reviewer.revision !== expectedRevision) {
    const completedRetry =
      initial.reviewer.revision === expectedRevision + 1 &&
      requestsAlreadyCommitted({ requests, exchange: initial.exchange });
    if (!completedRetry) {
      return { ok: false, current: initial.reviewer };
    }
    const written = await writeFeedbackPackage({ store, feedback, brief });
    await writeRevisionSnapshot({
      store,
      revision: sourceRevision,
      source,
    });
    for (const request of requests) {
      await writeAgentRequest({ store, request });
    }
    await publishReviewEvent({ store, event });
    return { ok: true, snapshot: initial.reviewer, package: written };
  }

  const written = await writeFeedbackPackage({ store, feedback, brief });
  await testingCheckpoint?.("feedback-package");
  await writeRevisionSnapshot({
    store,
    revision: sourceRevision,
    source,
  });
  await testingCheckpoint?.("source-revision");
  for (const request of requests) {
    await writeAgentRequest({ store, request });
  }
  await testingCheckpoint?.("agent-requests");
  const current = await loadDurableReview({
    store,
    sessionId: feedback.sessionId,
    planId: feedback.planId,
    validators,
  });
  const submitted = new Set(submittedCommentIds);
  const saved = await saveReviewerState({
    store,
    expectedRevision,
    validators,
    next: {
      drafts: current.reviewer.drafts.filter(
        (draft) => !submitted.has(draft.id),
      ),
      activeDraft: "",
      resolvedCommentIds: current.reviewer.resolvedCommentIds,
    },
  });
  if (!saved.ok) return saved;
  await testingCheckpoint?.("reviewer-state");
  await publishReviewEvent({ store, event });
  await testingCheckpoint?.("review-event");
  return { ok: true, snapshot: saved.snapshot, package: written };
};
