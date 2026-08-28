// Owns locked changes to stored agent requests and the plan-wide claim gate.
// Request creation and resolution share `.resolved.lock`, so a resolve and a
// new reply or feedback cannot interleave into a resolved thread that holds
// outstanding work.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentExchangeRejected,
  deriveSnapshotDigest,
  outstandingAgentRequests,
  readAgentCommentHistory,
  readValidatedAgentRequests,
  requestBaselineSnapshot,
  requestBlocksPlanPickup,
  requestIsTerminal,
  validateAgentRequest,
} from "./agent-exchange.js";
import type {
  AgentChatRequest,
  AgentFeedbackRequest,
  AgentPushRequest,
  AgentReplyRequest,
  AgentRequest,
  AgentResponse,
} from "./agent-exchange.js";
import {
  deduplicateReviewImageReferences,
  extractReviewImageReferences,
} from "./shared/review-image.js";
import { agentStillOwnsRequest } from "./shared/request-ownership.js";
import { validateResolvedCommentIds } from "./shared/comment.js";
import { RESOLVED_THREAD_NEW_WORK_ERROR } from "./shared/resolved-thread-work.js";
import {
  anchorReviewStore,
  appendAgentConnectionEvent,
  appendProgressValue,
  compactProgressLog,
  deleteAgentRequestValue,
  hasPreparedMutationJournal,
  highestAgentMutationStageGeneration,
  nextProgressSequence,
  readAgentConnectionEvents,
  readAgentRequestValue,
  readResolvedCommentIds,
  removeAgentMutationStages,
  ReviewStorePathRejected,
  withReviewStoreLock,
  writeAgentRequestValue,
  writeAgentResponseValue,
  writeSnapshot,
} from "./store.js";
import {
  changeSetIdsFor,
  recordCommittedRevision,
} from "./change-set-commit.js";
import type { CommittedPlanRevision } from "./change-set-commit.js";
import {
  claimIsHeldByAnother,
  claimIsLive,
  claimLeaseExpiryMs,
} from "./shared/agent-claim.js";
import { agentConnectionReasonSupersedes } from "./shared/agent-status.js";
import type { AgentModelIdentity } from "./shared/agent-model.js";
import type {
  AgentRequestDeletionResult,
  ProgressEvent,
  ReviewStore,
} from "./store.js";
import type { MutationStage } from "./staged-plan-mutation.js";

const REQUEST_ID = /^[a-f0-9]{16}$/;

const namedCommentIds = (request: AgentRequest): ReadonlyArray<string> =>
  request.kind === "feedback"
    ? request.comments.map((comment) => comment.id)
    : request.kind === "reply"
      ? [request.commentId]
      : request.kind === "push"
        ? [request.threadId]
        : [];

export class ResolvedThreadWorkRejected extends AgentExchangeRejected {
  constructor() {
    super(RESOLVED_THREAD_NEW_WORK_ERROR);
    this.name = "ResolvedThreadWorkRejected";
  }
}

/** Refuses create when any named thread is still resolved. */
export const assertCommentsAreUnresolved = async ({
  store,
  commentIds,
}: {
  readonly store: ReviewStore;
  readonly commentIds: ReadonlyArray<string>;
}): Promise<void> => {
  if (commentIds.length === 0) return;
  const resolved = new Set(
    await readResolvedCommentIds({
      store,
      validate: validateResolvedCommentIds,
    }),
  );
  if (commentIds.some((commentId) => resolved.has(commentId))) {
    throw new ResolvedThreadWorkRejected();
  }
};

export class RetryableAgentClaimRejected extends AgentExchangeRejected {}

export class AgentClaimContended extends RetryableAgentClaimRejected {}

export class AgentClaimSelectionStale extends RetryableAgentClaimRejected {}

export class AgentClaimCanceled extends AgentClaimSelectionStale {}

type Clock = () => number;

const readClock = (clock: Clock): number => {
  const nowMs = clock();
  if (!Number.isFinite(nowMs)) {
    throw new AgentExchangeRejected(
      "The mailbox clock must return milliseconds",
    );
  }
  return nowMs;
};

/** Runs one request change while the request file is locked. */
/**
 * The request lock stayed held for the whole waiting budget, so this attempt
 * never ran and nothing was written. It is named rather than described because
 * a caller deciding what to tell an operator has to tell "try again" apart from
 * a failure no retry can clear.
 */
export class RequestLockContended extends AgentExchangeRejected {
  constructor() {
    super("Another process is changing this request. Try again.");
    this.name = "RequestLockContended";
  }
}

const withRequestLock = async <TResult>({
  store,
  requestId,
  change,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly change: (store: ReviewStore) => Promise<TResult>;
}): Promise<TResult> => {
  if (!REQUEST_ID.test(requestId)) {
    throw new AgentExchangeRejected(
      "A request id must be 16 hexadecimal characters",
    );
  }
  let lockedStore: ReviewStore;
  try {
    const anchoredStore = await anchorReviewStore(store);
    const [requestDirectory, responseDirectory] = await Promise.all([
      anchoredStore.resolveDirectoryPath({
        directory: "agentRequestDirectory",
      }),
      anchoredStore.resolveDirectoryPath({
        directory: "agentResponseDirectory",
      }),
    ]);
    lockedStore = {
      ...store,
      agentRequestDirectory: requestDirectory.path,
      agentResponseDirectory: responseDirectory.path,
    };
  } catch (error: unknown) {
    if (!(error instanceof ReviewStorePathRejected)) throw error;
    throw new AgentExchangeRejected("The request mailbox is unavailable");
  }
  return withReviewStoreLock({
    lockPath: join(lockedStore.agentRequestDirectory, `.${requestId}.lock`),
    change: () => change(lockedStore),
    timeoutError: () => new RequestLockContended(),
    invalidLockError: () =>
      new AgentExchangeRejected("The request mailbox is unavailable"),
  });
};

const resolvedCommentLockPath = (store: ReviewStore): string =>
  join(store.reviewDirectory, ".resolved.lock");

/**
 * Serializes resolution writes against create-time unresolved checks. The
 * request lock still owns one request file; this lock owns the pairing of
 * resolved.json with outstanding work.
 */
export const withResolvedCommentLock = async <TResult>({
  store,
  change,
}: {
  readonly store: ReviewStore;
  readonly change: (store: ReviewStore) => Promise<TResult>;
}): Promise<TResult> =>
  withReviewStoreLock({
    lockPath: resolvedCommentLockPath(store),
    change: () => change(store),
    timeoutError: () =>
      new AgentExchangeRejected(
        "Another process is changing resolved threads. Try again.",
      ),
    invalidLockError: () =>
      new AgentExchangeRejected("The request mailbox is unavailable"),
  });

/**
 * The plan-wide claim gate.
 *
 * Exported so the disconnect route can decide, against a plan whose claim state
 * cannot move underneath it, whether the agent it is disconnecting holds work.
 */
export const withPlanClaimLock = async <TResult>({
  store,
  change,
}: {
  readonly store: ReviewStore;
  readonly change: (store: ReviewStore) => Promise<TResult>;
}): Promise<TResult> => {
  let lockedStore: ReviewStore;
  try {
    lockedStore = await (await anchorReviewStore(store)).resolveStore();
  } catch (error: unknown) {
    if (!(error instanceof ReviewStorePathRejected)) throw error;
    throw new AgentExchangeRejected("The request mailbox is unavailable");
  }
  return withReviewStoreLock({
    lockPath: join(lockedStore.reviewDirectory, ".agent-claim.lock"),
    change: () => change(lockedStore),
    timeoutError: () =>
      new AgentExchangeRejected(
        "Another agent is claiming work on this plan. Try again.",
      ),
    invalidLockError: () =>
      new AgentExchangeRejected("The request mailbox is unavailable"),
  });
};

/** Checks the identity fields shared by one request and response. */
const responseMatchesRequest = ({
  value,
  request,
}: {
  readonly value: unknown;
  readonly request: AgentRequest;
}): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  "version" in value &&
  value.version === 3 &&
  "requestId" in value &&
  value.requestId === request.requestId &&
  "sessionId" in value &&
  value.sessionId === request.sessionId &&
  "planId" in value &&
  value.planId === request.planId &&
  "kind" in value &&
  value.kind === request.kind;

/** Reads and validates one request while its mailbox lock is held. */
const readCurrentRequest = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<AgentRequest> => {
  const request = validateAgentRequest(
    await readAgentRequestValue({ store, requestId }),
  );
  if (request.requestId !== requestId) {
    throw new AgentExchangeRejected(
      "The stored request id does not match its file name",
    );
  }
  return request;
};

/**
 * Drops the claim from a request the reviewer has taken back.
 *
 * An edit that left the claim in place would sit underneath it: the previous
 * agent still holds the token, and answering is guarded by ownership rather
 * than by lease freshness, so a late return could publish over the message the
 * reviewer replaced. Removing the claim refuses that answer through the rule
 * that already guards delivery, and returns the request to the queue for
 * whichever agent connects next (BIG-120).
 *
 * A claim's fields are stored and validated as one unit, so a field added to a
 * claim later and forgotten here fails validation loudly rather than surviving
 * the release.
 */
const withoutClaim = (request: AgentRequest): Record<string, unknown> => {
  const released: Record<string, unknown> = { ...request };
  delete released.baselineSnapshot;
  delete released.claimedAt;
  delete released.claimedBy;
  delete released.claimedByConnection;
  delete released.claimedModel;
  delete released.claimExpiresAtMs;
  delete released.claimGeneration;
  return released;
};

/**
 * The submission a request was created from, with everything a lifecycle adds
 * to it removed, so a resend can be compared against what is already stored.
 *
 * The claim's own fields are dropped through `withoutClaim`, because a claim
 * field added later and forgotten here would silently change this comparison
 * rather than fail.
 */
const requestCreation = (request: AgentRequest): string => {
  const created = withoutClaim(request);
  delete created.answeredAt;
  delete created.canceledAt;
  return JSON.stringify(created);
};

/**
 * Refuses to take a request back from a commit that has already won.
 *
 * Same reasoning as the cancel guard, and the same lock: a journal on disk
 * under this lock means the answer has published or is one rename from
 * publishing, and recovery finishes it by restoring the claim it names. Editing
 * or deleting the request underneath that would leave the plan carrying a
 * revision no record can explain.
 */
const assertNotPublishing = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<void> => {
  if (!(await hasPreparedMutationJournal({ store, requestId }))) return;
  throw new AgentExchangeRejected(
    "The agent's answer for this request is already publishing, so it can no longer be changed",
  );
};

/**
 * Refuses every state in which taking one comment out of a feedback request
 * would race the agent or contradict a settled answer.
 *
 * A canceled request is not refused: the removal answers with the stored
 * request rather than treating a repeat as a conflict. Answers with the batch
 * it proved, so a caller cannot narrow the kind a second way.
 */
const assertCommentIsRemovable = async ({
  store,
  request,
  agentConnected,
  nowMs,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
  /** Whether the presence lease reports an agent attached right now. */
  readonly agentConnected: boolean;
  readonly nowMs: number;
}): Promise<AgentFeedbackRequest> => {
  if (request.kind !== "feedback") {
    throw new AgentExchangeRejected(
      "Only a feedback request can remove a queued comment",
    );
  }
  if (agentStillOwnsRequest({ request, agentConnected, nowMs })) {
    throw new AgentExchangeRejected(
      "The agent has already picked up this feedback request",
    );
  }
  if (request.claimedAt !== undefined) {
    await assertNotPublishing({ store, requestId: request.requestId });
  }
  // A settled answer keeps its claim, because the stored response is only
  // readable while the request it answers still names the claim that published
  // it. Reached whenever an answer was stamped after the route read the
  // exchange - by recovery settling an interrupted commit, or by a stored
  // response this build cannot read.
  if (request.answeredAt !== undefined) {
    throw new AgentExchangeRejected(
      "The agent has already answered this request",
    );
  }
  return request;
};

/**
 * A cancel the mailbox refused because the answer it would withdraw has already
 * landed or is landing. It is a distinct class because it is the opposite news
 * from the ordinary rejection a caller expects here: a request that is missing
 * or already canceled leaves nothing to do, while this one means the record and
 * the mailbox now disagree and somebody has to be told.
 */
export class AgentRequestNotWithdrawable extends AgentExchangeRejected {
  constructor(message: string) {
    super(message);
    this.name = "AgentRequestNotWithdrawable";
  }
}

/**
 * A cancel that found the request already answered. It is settled news rather
 * than a failure - the answer is in, so there is nothing left to withdraw - and
 * it is a class rather than a message so a caller can say so without matching
 * the sentence Big Plan happens to phrase it with.
 */
export class AgentRequestAlreadyAnswered extends AgentExchangeRejected {
  constructor() {
    super("The agent has already answered this request");
    this.name = "AgentRequestAlreadyAnswered";
  }
}

/**
 * Refuses every state in which withdrawing one request would contradict work
 * that already reached the plan. A canceled request is not refused: cancel is
 * idempotent.
 */
const assertRequestIsWithdrawable = async ({
  store,
  request,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
}): Promise<void> => {
  if (request.canceledAt !== undefined) return;
  if (request.answeredAt !== undefined) {
    throw new AgentRequestAlreadyAnswered();
  }
  // The commit writes its journal under this same request lock, so a journal
  // on disk here means the answer has published or is one rename from
  // publishing. Withdrawing it would leave the plan carrying a revision every
  // record calls canceled.
  const publishing = await hasPreparedMutationJournal({
    store,
    requestId: request.requestId,
  }).catch(() => {
    throw new AgentRequestNotWithdrawable(
      "Big Plan cannot tell whether the agent's answer for this request is already publishing, so it cannot be canceled",
    );
  });
  if (publishing) {
    throw new AgentRequestNotWithdrawable(
      "The agent's answer for this request is already publishing, so it can no longer be canceled",
    );
  }
};

/**
 * Drops the mutation stages a request can no longer publish from. The claim's
 * own fields go through `withoutClaim`; this is only the stages.
 *
 * They go for the reason a cancel drops them: neither a released generation nor
 * a terminal request can ever reach the plan - the commit boundary refuses a
 * generation its request no longer names, and a settled request refuses every
 * answer - so the private plan candidate would otherwise sit in the store for
 * the life of the plan.
 */
const dropUnpublishableStages = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<void> => {
  await removeAgentMutationStages({ store, requestId });
};

/**
 * Narrates a release, so the activity log never drops a claim in silence.
 *
 * The words are the caller's, because a release is only ever half the story:
 * the same drop reads as an abandoned claim being cleared out of the way in one
 * case and as the reviewer deliberately taking an agent off the plan in the
 * other, and a log that gave both the same line would be describing neither.
 */
const announceClaimRelease = async ({
  store,
  request,
  atMs,
  step,
  detail,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
  readonly atMs: number;
  readonly step: string;
  readonly detail: string;
}): Promise<void> => {
  await appendProgressEvent({
    store,
    event: {
      sessionId: request.sessionId,
      requestId: request.requestId,
      atMs,
      stepCode: "claim-released",
      step,
      state: "done",
      detail,
    },
  }).catch(() => undefined);
};

const ABANDONED_CLAIM_RELEASE = {
  step: "Claim released after the agent stopped reporting",
  detail:
    "The reviewer changed this message once the claim on it was abandoned, so the previous agent session can no longer answer it",
} as const;

export const ensureAgentRequest = async ({
  store,
  request,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
}): Promise<AgentRequest> => {
  const intended = validateAgentRequest(request);
  return withRequestLock({
    store,
    requestId: intended.requestId,
    change: async (lockedStore) => {
      const value = await readAgentRequestValue({
        store: lockedStore,
        requestId: intended.requestId,
      });
      if (value === undefined) {
        return withResolvedCommentLock({
          store: lockedStore,
          change: async () => {
            await assertCommentsAreUnresolved({
              store: lockedStore,
              commentIds: namedCommentIds(intended),
            });
            await writeAgentRequestValue({
              store: lockedStore,
              requestId: intended.requestId,
              value: intended,
            });
            return intended;
          },
        });
      }
      const existing = validateAgentRequest(value);
      if (
        existing.requestId !== intended.requestId ||
        requestCreation(existing) !== requestCreation(intended)
      ) {
        throw new AgentExchangeRejected(
          "The stored request conflicts with this feedback submission",
        );
      }
      if (existing.canceledAt !== undefined) {
        throw new AgentExchangeRejected(
          "The feedback submission was canceled by the reviewer",
        );
      }
      return existing;
    },
  });
};

/**
 * Refuses when some other request on this plan is being worked right now.
 *
 * One plan carries one live claim, so this is asked of every claim that is not
 * simply renewing a lease it already holds - including one reviving a lapsed
 * claim, because the plan was free while that lease was expired and another
 * agent may have taken it in the meantime.
 */
const assertPlanIsFree = async ({
  store,
  activeSessionId,
  planId,
  requestId,
  claimedBy,
  nowMs,
}: {
  readonly store: ReviewStore;
  readonly activeSessionId: string;
  readonly planId: string;
  readonly requestId: string;
  readonly claimedBy?: string;
  readonly nowMs: number;
}): Promise<void> => {
  const requests = await readValidatedAgentRequests({
    store,
    sessionId: activeSessionId,
    planId,
  });
  const blockingRequest = requests.find(
    (candidate) =>
      candidate.requestId !== requestId &&
      requestBlocksPlanPickup({ request: candidate, nowMs }),
  );
  if (claimedBy !== undefined && blockingRequest?.claimedBy === claimedBy) {
    throw new AgentClaimContended(
      "This agent is mid-answer on another request; respond to it first, or ask the reviewer to cancel it, so the two publishes stay separate revisions",
    );
  }
  if (blockingRequest !== undefined) {
    throw new AgentClaimContended(
      "Another agent session is working on this plan",
    );
  }
};

export type MintAgentPushResult = {
  readonly request: AgentPushRequest;
  readonly stage: MutationStage;
  readonly threadOpened: boolean;
  readonly queuedReviewerMessages: number;
};

/**
 * Opens and claims one agent-initiated request against a frozen plan snapshot.
 *
 * The plan claim lock comes before the new request lock, matching ordinary
 * pickup. The snapshot is durable before either the request or its stage can
 * refer to it, and the request is visible only after every plan-wide refusal
 * has passed.
 */
export const mintAgentPush = async ({
  store,
  planPath,
  activeSessionId,
  planId,
  requestId,
  claimedBy,
  connectionToken,
  model,
  origin,
  body,
  threadId,
  now,
  clock = Date.now,
}: {
  readonly store: ReviewStore;
  readonly planPath: string;
  readonly activeSessionId: string;
  readonly planId: string;
  readonly requestId: string;
  readonly claimedBy: string;
  readonly connectionToken?: string;
  readonly model?: AgentModelIdentity;
  readonly origin: AgentPushRequest["origin"];
  readonly body: string;
  readonly threadId?: string;
  readonly now: string;
  readonly clock?: Clock;
}): Promise<MintAgentPushResult> => {
  if (Number.isNaN(Date.parse(now))) {
    throw new AgentExchangeRejected("A claim time must be an ISO timestamp");
  }
  const minted = await withPlanClaimLock({
    store,
    change: (planStore) =>
      withRequestLock({
        store: planStore,
        requestId,
        change: async (lockedStore) => {
          const nowMs = readClock(clock);
          await assertPlanIsFree({
            store: lockedStore,
            activeSessionId,
            planId,
            requestId,
            claimedBy,
            nowMs,
          });
          return withResolvedCommentLock({
            store: lockedStore,
            change: async () => {
              const requests = await readValidatedAgentRequests({
                store: lockedStore,
                sessionId: activeSessionId,
                planId,
              });
              const openPush = requests.find(
                (candidate): candidate is AgentPushRequest =>
                  candidate.kind === "push" &&
                  candidate.answeredAt === undefined &&
                  candidate.canceledAt === undefined,
              );
              if (openPush !== undefined) {
                throw new AgentExchangeRejected(
                  `This agent already holds an open push (thread ${openPush.threadId}); respond to it, or ask the reviewer to cancel it`,
                );
              }
              if (
                requests.some((candidate) => candidate.requestId === requestId)
              ) {
                throw new AgentExchangeRejected(
                  "The push request could not be created",
                );
              }
              const continuedThread =
                threadId === undefined
                  ? undefined
                  : requests.find(
                      (candidate) =>
                        candidate.kind === "push" &&
                        candidate.requestId === threadId &&
                        candidate.threadId === threadId,
                    );
              if (threadId !== undefined && continuedThread === undefined) {
                throw new AgentExchangeRejected(
                  `No pushed thread ${threadId} exists on this plan`,
                );
              }
              if (threadId !== undefined) {
                await assertCommentsAreUnresolved({
                  store: lockedStore,
                  commentIds: [threadId],
                });
              }
              const source = await readFile(planPath, "utf8");
              const premiseSnapshot = deriveSnapshotDigest(source);
              await writeSnapshot({
                store: lockedStore,
                snapshot: premiseSnapshot,
                source,
              });
              const actualThreadId = threadId ?? requestId;
              const unclaimed = validateAgentRequest({
                version: 3,
                kind: "push",
                requestId,
                sessionId: activeSessionId,
                planId,
                premiseSnapshot,
                createdAt: now,
                origin,
                body,
                threadId: actualThreadId,
                attachmentManifest: [],
                attachments: [],
              });
              if (unclaimed.kind !== "push") {
                throw new AgentExchangeRejected(
                  "The push request could not be created",
                );
              }
              await writeAgentRequestValue({
                store: lockedStore,
                requestId,
                value: unclaimed,
              });
              try {
                const request = validateAgentRequest({
                  ...unclaimed,
                  baselineSnapshot: premiseSnapshot,
                  claimedAt: now,
                  claimedBy,
                  claimedByConnection: connectionToken,
                  claimedModel: model,
                  claimExpiresAtMs: claimLeaseExpiryMs(nowMs),
                  claimGeneration: 1,
                });
                if (request.kind !== "push") {
                  throw new AgentExchangeRejected(
                    "The push request could not be claimed",
                  );
                }
                await writeAgentRequestValue({
                  store: lockedStore,
                  requestId,
                  value: request,
                });
                // The publication module imports the mailbox commit boundary, so
                // this late import keeps stage creation on the mint path without
                // introducing an eager module cycle during review startup.
                const { openMutationStage } =
                  await import("./staged-plan-mutation.js");
                const stage = await openMutationStage({
                  store: lockedStore,
                  requestId,
                  generation: 1,
                  claimedBy,
                  baseSnapshot: premiseSnapshot,
                  baseSource: source,
                  now,
                });
                return {
                  request,
                  stage,
                  threadOpened: threadId === undefined,
                  queuedReviewerMessages: requests.filter(
                    (candidate) =>
                      candidate.kind !== "push" &&
                      candidate.answeredAt === undefined &&
                      candidate.canceledAt === undefined,
                  ).length,
                };
              } catch (error: unknown) {
                const cleanup = await Promise.allSettled([
                  deleteAgentRequestValue({
                    store: lockedStore,
                    requestId,
                  }).then((result) => {
                    if (result.attachmentCleanup === "failed") {
                      throw result.cleanupError;
                    }
                  }),
                  removeAgentMutationStages({
                    store: lockedStore,
                    requestId,
                  }),
                ]);
                const cleanupFailures = cleanup.flatMap((result) =>
                  result.status === "rejected" ? [result.reason] : [],
                );
                if (cleanupFailures.length > 0) {
                  throw new AggregateError(
                    [error, ...cleanupFailures],
                    "The push request failed and could not be rolled back",
                    { cause: error },
                  );
                }
                throw error;
              }
            },
          });
        },
      }),
  });
  await appendProgressEvent({
    store,
    event: {
      sessionId: activeSessionId,
      requestId,
      atMs: readClock(clock),
      stepCode: "push-opened",
      step: "Agent opened a plan push",
      state: "live",
      detail: minted.threadOpened
        ? "New pushed thread"
        : `Continued pushed thread ${minted.request.threadId}`,
    },
  }).catch(() => undefined);
  return minted;
};

/**
 * Takes or renews one agent session's exclusive claim on a request, freezing
 * the source baseline the claim's work will be diffed against.
 *
 * The claim is an ownership lease, not just a baseline freeze. The plan claim
 * lock permits one live request claim across the plan, and the request lock
 * decides renewal, contention, and takeover for the selected request.
 *
 * Every claim also carries a generation. A renewal keeps it and a takeover
 * raises it, so the number says which claim a stage belongs to. A lapsed lease
 * during a long edit can no longer interleave plan writes: the displaced agent
 * still owns its own stage, and its generation is refused at the one commit
 * boundary that reaches the plan source.
 */
export const claimAgentRequest = async ({
  store,
  activeSessionId,
  requestId,
  claimedBy,
  connectionToken,
  model,
  baselineSnapshot,
  now,
  verifyBeforeClaim,
  clock = Date.now,
}: {
  readonly store: ReviewStore;
  readonly activeSessionId: string;
  readonly requestId: string;
  readonly claimedBy: string;
  /** The connection taking this claim, so the claim knows who holds it. */
  readonly connectionToken?: string;
  readonly model?: AgentModelIdentity;
  readonly baselineSnapshot: string;
  readonly now: string;
  readonly verifyBeforeClaim?: (request: AgentRequest) => Promise<void>;
  readonly clock?: Clock;
}): Promise<AgentRequest> => {
  if (Number.isNaN(Date.parse(now))) {
    throw new AgentExchangeRejected("A claim time must be an ISO timestamp");
  }
  const takeover = await withPlanClaimLock({
    store,
    change: (planStore) =>
      withRequestLock({
        store: planStore,
        requestId,
        change: async (
          lockedStore,
        ): Promise<{
          readonly request: AgentRequest;
          readonly reclaimedFrom?: string;
          readonly atMs: number;
        }> => {
          const request = await readCurrentRequest({
            store: lockedStore,
            requestId,
          });
          if (request.canceledAt !== undefined) {
            throw new AgentClaimCanceled(
              "The request was canceled by the reviewer",
            );
          }
          if (request.answeredAt !== undefined) {
            throw new AgentClaimSelectionStale(
              "The agent has already answered this request",
            );
          }
          await verifyBeforeClaim?.(request);
          const nowMs = readClock(clock);
          if (claimIsHeldByAnother({ request, claimedBy, nowMs })) {
            throw new AgentClaimContended(
              "Another agent session is working on this request",
            );
          }
          // A renewal of a claim that is still live is the ordinary path and
          // needs no plan-wide check: nothing else can be working this plan
          // while this claim holds it. A *lapsed* claim is different - the
          // plan was released when it expired, and another agent may have
          // taken it since - so reviving one asks the same question a fresh
          // claim asks.
          if (
            request.claimedBy === claimedBy &&
            !claimIsLive({ request, nowMs })
          ) {
            await assertPlanIsFree({
              store: lockedStore,
              activeSessionId,
              planId: request.planId,
              requestId,
              nowMs,
            });
          }
          if (request.claimedBy === claimedBy) {
            const renewed = validateAgentRequest({
              ...request,
              claimedModel: model ?? request.claimedModel,
              // A renewal that declares no connection is the same connection
              // continuing, exactly as an undeclared model is.
              claimedByConnection:
                connectionToken ?? request.claimedByConnection,
              // Renewal is the same claim continuing, so the generation - and
              // with it the agent's stage and its unfinished edits - stays.
              claimGeneration: request.claimGeneration ?? 1,
              claimExpiresAtMs: Math.max(
                request.claimExpiresAtMs ?? 0,
                claimLeaseExpiryMs(nowMs),
              ),
            });
            await writeAgentRequestValue({
              store: lockedStore,
              requestId,
              value: renewed,
            });
            return { request: renewed, atMs: nowMs };
          }
          await assertPlanIsFree({
            store: lockedStore,
            activeSessionId,
            planId: request.planId,
            requestId,
            nowMs,
          });
          // A takeover is a new claim, so it raises the generation. The
          // displaced holder keeps writing to a stage whose generation the
          // commit boundary no longer accepts.
          //
          // The stages on disk are read too, because a release drops the
          // claim's generation with the rest of it: reading the request alone
          // would hand generation 1 back after a release, and a returning
          // agent that recreated its old stage would resume the candidate it
          // drafted for the message the reviewer has since replaced. What this
          // read buys is bounded: a stage present when it runs can never be
          // resumed, because this claim outranks it. A stage recreated at the
          // same generation after the read still can, which needs a second
          // live process holding the same agent token and nothing published in
          // between; ruling that out needs a durable record of released
          // generations, which this deliberately does not add.
          const claimGeneration =
            Math.max(
              request.claimGeneration ?? 0,
              await highestAgentMutationStageGeneration({
                store: lockedStore,
                requestId,
              }),
            ) + 1;
          const claimed = validateAgentRequest({
            ...request,
            baselineSnapshot,
            claimedAt: now,
            claimedBy,
            claimedByConnection: connectionToken,
            claimedModel: model,
            claimExpiresAtMs: claimLeaseExpiryMs(nowMs),
            claimGeneration,
          });
          await writeAgentRequestValue({
            store: lockedStore,
            requestId,
            value: claimed,
          });
          return {
            request: claimed,
            atMs: nowMs,
            ...(request.claimedBy === undefined
              ? {}
              : { reclaimedFrom: request.claimedBy }),
          };
        },
      }),
  });
  if (takeover.reclaimedFrom !== undefined) {
    await appendProgressEvent({
      store,
      event: {
        sessionId: activeSessionId,
        requestId,
        atMs: takeover.atMs,
        stepCode: "request-reclaimed",
        step: "Restarting with a new agent session",
        state: "live",
        detail:
          "The previous agent stopped responding; its unpublished edits stay in its own claim stage and cannot reach this plan",
      },
    }).catch(() => undefined);
  }
  return takeover.request;
};

/**
 * Returns the work one agent was holding to the queue, without ending it.
 *
 * A disconnect drops the answer in flight and keeps the question. The reviewer
 * asked the agent to leave, not for their own comment to be thrown away, so the
 * claim goes and the request stays exactly where it was before anyone picked it
 * up - available to the next agent immediately, rather than after the lease it
 * would otherwise have to outlive (BIG-190).
 *
 * A request whose answer is already publishing keeps its claim. That answer is
 * one atomic rename from the plan and the commit boundary is what decides it;
 * pulling the claim out from under it would abandon a revision mid flight to
 * make a departure look tidier.
 */
export const releaseClaimsHeldBy = async ({
  store,
  sessionId,
  planId,
  claimedBy,
  step,
  detail,
  clock = Date.now,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly claimedBy: string;
  readonly step: string;
  readonly detail: string;
  readonly clock?: Clock;
}): Promise<ReadonlyArray<string>> => {
  const nowMs = readClock(clock);
  const held = (
    await readValidatedAgentRequests({ store, sessionId, planId })
  ).filter(
    (request) =>
      request.claimedBy === claimedBy &&
      request.claimedAt !== undefined &&
      request.answeredAt === undefined &&
      request.canceledAt === undefined,
  );
  const released: Array<string> = [];
  for (const candidate of held) {
    const requestId = candidate.requestId;
    let request: AgentRequest;
    try {
      request = await withRequestLock({
        store,
        requestId,
        change: async (lockedStore) => {
          const current = await readCurrentRequest({
            store: lockedStore,
            requestId,
          });
          // The candidate list was read without a lock, and `claimAgentRequest`
          // takes this same request lock to hand a lapsed claim to a new agent.
          // Without this test, a takeover landing in that gap would have its
          // claim stripped and its staged edits deleted by a disconnect aimed
          // at the agent it replaced - work destroyed for an agent that is
          // still live and was never disconnected.
          if (current.claimedBy !== claimedBy) {
            throw new AgentExchangeRejected(
              "Another agent now holds the claim on this request",
            );
          }
          await assertRequestIsWithdrawable({
            store: lockedStore,
            request: current,
          });
          const dropped = validateAgentRequest(withoutClaim(current));
          await writeAgentRequestValue({
            store: lockedStore,
            requestId,
            value: dropped,
          });
          await dropUnpublishableStages({ store: lockedStore, requestId });
          return dropped;
        },
      });
    } catch (error: unknown) {
      // A request that cannot be withdrawn keeps its claim, and the disconnect
      // it belongs to still stands. Reporting it as an error would refuse the
      // reviewer's decision over an answer that is about to land anyway.
      if (error instanceof AgentExchangeRejected) continue;
      throw error;
    }
    released.push(requestId);
    await announceClaimRelease({ store, request, atMs: nowMs, step, detail });
  }
  return released;
};

/** Marks one request terminal. A later pickup or response cannot revive it. */
export const cancelAgentRequest = async ({
  store,
  requestId,
  now,
  beforeCancel,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly now: string;
  /** Commits the owning withdrawal while this request cannot be created. */
  readonly beforeCancel?: () => Promise<void>;
}): Promise<AgentRequest> =>
  withRequestLock({
    store,
    requestId,
    change: async (lockedStore) => {
      await beforeCancel?.();
      const request = await readCurrentRequest({
        store: lockedStore,
        requestId,
      });
      await assertRequestIsWithdrawable({ store: lockedStore, request });
      if (request.canceledAt !== undefined) return request;
      const canceled = validateAgentRequest({ ...request, canceledAt: now });
      await writeAgentRequestValue({
        store: lockedStore,
        requestId,
        value: canceled,
      });
      // A withdrawn request can never publish, so the claim stages it opened -
      // one private plan copy per generation - go with it rather than sitting
      // in the store for the life of the plan.
      await removeAgentMutationStages({ store: lockedStore, requestId });
      return canceled;
    },
  });

/**
 * Writes one runtime-authored request only while its owning state still permits
 * delivery. The condition runs under the same request lock cancellation uses,
 * so a mutation that resumes after its HTTP gate timed out cannot recreate
 * work a later reviewer action already withdrew.
 */
export const writeAgentRequestWhen = async ({
  store,
  request,
  permitted,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
  readonly permitted: () => Promise<boolean>;
}): Promise<boolean> => {
  const checked = validateAgentRequest(request);
  return withRequestLock({
    store,
    requestId: checked.requestId,
    change: async (lockedStore) => {
      if (!(await permitted())) return false;
      await writeAgentRequestValue({
        store: lockedStore,
        requestId: checked.requestId,
        value: checked,
      });
      return true;
    },
  });
};

/** Recognizes a reply whose thread was opened by an agent push. */
const requestTargetsPushedThread = async ({
  store,
  request,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
}): Promise<boolean> => {
  if (request.kind === "push") return true;
  if (request.kind !== "reply") return false;
  const requests = await readValidatedAgentRequests({
    store,
    sessionId: request.sessionId,
    planId: request.planId,
  });
  return requests.some(
    (candidate) =>
      candidate.kind === "push" && candidate.threadId === request.commentId,
  );
};

/** Describes one committed revision to the Change Engine's change sets. */
const committedRevisionOf = async ({
  store,
  request,
  response,
  at,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
  readonly response: AgentResponse;
  readonly at: string;
}): Promise<CommittedPlanRevision | undefined> => {
  const baseSnapshot = requestBaselineSnapshot(request);
  if (
    request.kind === "approval" ||
    response.kind === "approval" ||
    (request.kind === "push" && response.resultSnapshot === baseSnapshot)
  ) {
    return undefined;
  }
  return {
    requestId: response.requestId,
    changeSetIds: changeSetIdsFor({
      response,
      isPushedThread: await requestTargetsPushedThread({ store, request }),
    }),
    baseSnapshot,
    resultSnapshot: response.resultSnapshot,
    provenance: response.kind,
    committedAt: at,
  };
};

export class AgentClaimGenerationStale extends AgentExchangeRejected {
  constructor() {
    super(
      "Another agent now holds the claim on this request; this claim generation can no longer publish",
    );
    this.name = "AgentClaimGenerationStale";
  }
}

/**
 * Answers one request and marks it terminal as a single commit.
 *
 * `publish` is the plan-source swap, and it runs here because this is where
 * ownership has just been re-proved and the request file cannot move under it.
 * Everything the publisher needs to abandon the attempt without a trace it does
 * before returning; everything after it is bookkeeping recovery can finish.
 */
export const commitRequestTerminal = async ({
  store,
  response,
  claimedBy,
  publish,
  now,
}: {
  readonly store: ReviewStore;
  readonly response: AgentResponse;
  readonly claimedBy: string;
  /** Publishes the source revision while the request cannot change. */
  readonly publish?: () => Promise<void>;
  readonly now: string;
}): Promise<AgentRequest> =>
  withRequestLock({
    store,
    requestId: response.requestId,
    change: async (lockedStore) => {
      const request = await readCurrentRequest({
        store: lockedStore,
        requestId: response.requestId,
      });
      if (request.canceledAt !== undefined) {
        throw new AgentExchangeRejected(
          "The request was canceled by the reviewer",
        );
      }
      if (
        request.claimedAt === undefined ||
        request.baselineSnapshot === undefined
      ) {
        // Also where a late return lands after abandonment: a claim proven
        // abandoned is released when the reviewer edits the message it was
        // holding, so the answer would be to a message that no longer exists
        // in that form (BIG-120).
        throw new AgentExchangeRejected(
          "The request must be claimed before it can be answered. A claim released after it was abandoned cannot answer it either; run `big-plan agent next` to pick up current work.",
        );
      }
      // Answered first: a replay of a settled request is better reported as
      // settled than as a claim dispute, whoever replays it.
      if (request.answeredAt !== undefined) {
        throw new AgentExchangeRejected(
          "The agent has already answered this request",
        );
      }
      // Only a live claim may answer, and the answer names the generation it
      // was drafted for. Every takeover raises that number, so a superseded
      // claim stops here whether or not it still recognises the token it holds
      // - which is the case the ownership test alone cannot see, because an
      // agent that reclaimed the same request keeps its own token across the
      // generation it lost.
      if (request.claimGeneration !== response.claimGeneration) {
        throw new AgentClaimGenerationStale();
      }
      // Ownership is tested too, and it is ownership rather than lease
      // freshness. A lease lapses on the normal path: `agent next` hands the
      // work over and exits, so nothing renews the claim between progress
      // notes, and a turn longer than the window would otherwise have its
      // finished answer refused - losing the reviewer's message, which is the
      // one failure adr/0002 exists to prevent (BIG-147). A settled request is
      // refused above.
      if (request.claimedBy !== claimedBy) {
        throw new AgentExchangeRejected(
          "Another agent now holds the claim on this request",
        );
      }
      if (!responseMatchesRequest({ value: response, request })) {
        throw new AgentExchangeRejected(
          "The agent response does not match its request",
        );
      }
      await publish?.();
      const answered = validateAgentRequest({
        ...request,
        answeredAt: now,
      });
      await writeAgentResponseValue({
        store: lockedStore,
        requestId: response.requestId,
        value: response,
      });
      // The Change Engine learns about a revision here and nowhere else, so a
      // change set can only ever describe work that crossed this boundary.
      const revision = await committedRevisionOf({
        store: lockedStore,
        request,
        response,
        at: now,
      });
      if (revision !== undefined) {
        await recordCommittedRevision({ store: lockedStore, revision });
      }
      await writeAgentRequestValue({
        store: lockedStore,
        requestId: response.requestId,
        value: answered,
      });
      return answered;
    },
  });

/**
 * Finishes a commit whose journal already proves the source swap won.
 *
 * Recovery reaches this with the plan file carrying the result revision, so
 * refusing an already-answered request would strand the reviewer's message
 * rather than protect it. Writing what is already written is the correct
 * answer here, and it is the only place that is true.
 *
 * The rename is this design's linearization point, so anything recorded after
 * it arrived too late by the model's own definition: the plan already carries
 * the published revision, and every record has to converge on that. A cancel
 * is therefore dropped as the answer is stamped, and the claim the settled
 * request names is restored to the one that published rather than to a
 * takeover that came after. Without that, the stored answer would describe a
 * generation its own request no longer names, and every reader would discard
 * it as mismatched - an answered thread with no answer in it.
 *
 * Nothing durable is written until the settled request is in hand, so an
 * attempt that cannot settle leaves no response and no change-set revision for
 * a request that never became terminal.
 */
export const completeRequestTerminal = async ({
  store,
  response,
  claim,
  now,
}: {
  readonly store: ReviewStore;
  readonly response: AgentResponse;
  readonly claim: {
    readonly baselineSnapshot: string;
    readonly claimedBy: string;
    readonly claimGeneration: number;
  };
  readonly now: string;
}): Promise<AgentRequest> =>
  withRequestLock({
    store,
    requestId: response.requestId,
    change: async (lockedStore) => {
      const request = await readCurrentRequest({
        store: lockedStore,
        requestId: response.requestId,
      });
      if (request.answeredAt !== undefined) return request;
      const answered = validateAgentRequest({
        ...request,
        baselineSnapshot: claim.baselineSnapshot,
        claimedBy: claim.claimedBy,
        claimGeneration: claim.claimGeneration,
        canceledAt: undefined,
        answeredAt: now,
      });
      await writeAgentResponseValue({
        store: lockedStore,
        requestId: response.requestId,
        value: response,
      });
      const revision = await committedRevisionOf({
        store: lockedStore,
        request: answered,
        response,
        at: now,
      });
      if (revision !== undefined) {
        await recordCommittedRevision({ store: lockedStore, revision });
      }
      await writeAgentRequestValue({
        store: lockedStore,
        requestId: response.requestId,
        value: answered,
      });
      return answered;
    },
  });

const AGENT_STARTED = "The agent already started on this message";

/**
 * Reads one queued reviewer message and refuses every state in which changing
 * it would race the agent. Feedback requests carry comments rather than a body,
 * so `removeCommentFromQueuedFeedbackRequest` owns their queued edits instead.
 */
const readQueuedMessage = async ({
  store,
  requestId,
  verb,
  allowCanceled,
  agentConnected,
  nowMs,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly verb: string;
  readonly allowCanceled: boolean;
  readonly agentConnected: boolean;
  readonly nowMs: number;
}): Promise<AgentReplyRequest | AgentChatRequest> => {
  const request = await readCurrentRequest({ store, requestId });
  if (
    request.kind === "feedback" ||
    request.kind === "push" ||
    request.kind === "approval"
  ) {
    throw new AgentExchangeRejected(
      `Only a reply or plan question can be ${verb} while it waits`,
    );
  }
  if (!allowCanceled && request.canceledAt !== undefined) {
    throw new AgentExchangeRejected("The request was canceled by the reviewer");
  }
  if (agentStillOwnsRequest({ request, agentConnected, nowMs })) {
    throw new AgentExchangeRejected(AGENT_STARTED);
  }
  // Reached with a claim only when that claim is proven abandoned, which is
  // exactly when the commit boundary has to be asked whether it got there
  // first.
  if (request.claimedAt !== undefined) {
    await assertNotPublishing({ store, requestId });
  }
  if (request.answeredAt !== undefined) {
    throw new AgentExchangeRejected(
      "The agent has already answered this request",
    );
  }
  return request;
};

/**
 * Replaces the body of one waiting message. Images are frozen when a message is
 * first sent, so a revision may drop or keep them but never introduce one; the
 * reviewer deletes the message and sends a new one to change its pictures.
 */
export const reviseQueuedRequest = async ({
  store,
  requestId,
  body,
  agentConnected,
  clock = Date.now,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly body: string;
  /** Whether the presence lease reports an agent attached right now. */
  readonly agentConnected: boolean;
  readonly clock?: Clock;
}): Promise<AgentReplyRequest | AgentChatRequest> => {
  const nowMs = readClock(clock);
  const { revised, released } = await withRequestLock({
    store,
    requestId,
    change: async (lockedStore) => {
      const request = await readQueuedMessage({
        store: lockedStore,
        requestId,
        verb: "revised",
        allowCanceled: false,
        agentConnected,
        nowMs,
      });
      const frozen = new Map(
        request.attachmentManifest.map((attachment) => [
          attachment.id,
          attachment,
        ]),
      );
      const attachments = deduplicateReviewImageReferences(
        extractReviewImageReferences(body),
      ).map((reference) => {
        const attachment = frozen.get(reference.id);
        if (attachment === undefined) {
          throw new AgentExchangeRejected(
            "A waiting message cannot gain a new image. Delete it and send a new one.",
          );
        }
        return { ...attachment, alt: reference.alt };
      });
      const revised = validateAgentRequest({
        ...withoutClaim(request),
        body,
        attachments,
      });
      if (revised.kind !== "reply" && revised.kind !== "chat") {
        throw new AgentExchangeRejected(
          "Revising this message changed the request kind",
        );
      }
      await writeAgentRequestValue({
        store: lockedStore,
        requestId,
        value: revised,
      });
      const released = request.claimedAt !== undefined;
      if (released)
        await dropUnpublishableStages({ store: lockedStore, requestId });
      return { revised, released };
    },
  });
  // Announced outside the request lock, in the order `claimAgentRequest`
  // established for the takeover this mirrors.
  if (released) {
    await announceClaimRelease({
      store,
      request: revised,
      atMs: nowMs,
      ...ABANDONED_CLAIM_RELEASE,
    });
  }
  return revised;
};

/**
 * Frees the open claims on a plan when the reviewer changes who answers.
 *
 * The reviewer answered this question in the plan: a hand-off fences the
 * incumbent at once rather than letting it finish. Without this, primacy would
 * move while the open request stayed claimed, and the new primary would sit
 * waiting behind a lease belonging to an agent that can no longer publish -
 * which is the stalled queue the whole change exists to remove.
 *
 * The displaced agent is fenced exactly as a takeover fences it: its stage is
 * dropped, so the generation it drafted for can never publish, and its next
 * command answers NOT_PRIMARY rather than silence.
 *
 * `claimedBy` narrows that to one agent's own claims, and every caller that
 * means one agent must pass it. A reviewer's answer about agent A must not be
 * able to reach into a turn agent B is mid way through: unnarrowed, an answer
 * about a stale card stripped the working primary's live claim and discarded
 * its turn under a progress line about a change the reviewer never made.
 */
export const releaseClaimsForPrimacyHandoff = async ({
  store,
  sessionId,
  planId,
  claimedBy,
  step = "Claim released when you changed the primary agent",
  detail = "The new primary answers this message; the previous agent keeps its draft and can no longer publish it",
  clock = Date.now,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  /** The one agent whose claims this answer frees, when it is about one. */
  readonly claimedBy?: string;
  /** What the reviewer's log calls this release. */
  readonly step?: string;
  readonly detail?: string;
  readonly clock?: Clock;
}): Promise<ReadonlyArray<AgentRequest>> => {
  const nowMs = readClock(clock);
  const holdsTheClaim = (request: AgentRequest): boolean =>
    claimedBy === undefined || request.claimedBy === claimedBy;
  const open = (
    await readValidatedAgentRequests({ store, sessionId, planId })
  ).filter(
    (request) =>
      !requestIsTerminal(request) &&
      request.claimedAt !== undefined &&
      holdsTheClaim(request),
  );
  const released: Array<AgentRequest> = [];
  for (const candidate of open) {
    const next = await withRequestLock({
      store,
      requestId: candidate.requestId,
      change: async (lockedStore) => {
        const current = await readCurrentRequest({
          store: lockedStore,
          requestId: candidate.requestId,
        });
        // Re-read under the lock: the holder may have answered in between, and
        // releasing a terminal request would rewrite settled history. The
        // holder may also have changed, so the narrowing is re-proved here
        // rather than trusted from the read above.
        if (
          requestIsTerminal(current) ||
          current.claimedAt === undefined ||
          !holdsTheClaim(current)
        ) {
          return undefined;
        }
        const freed = validateAgentRequest(withoutClaim(current));
        await writeAgentRequestValue({
          store: lockedStore,
          requestId: candidate.requestId,
          value: freed,
        });
        /*
        The displaced agent's stage is deliberately left on disk.

        Releasing a claim drops its generation with the rest of it, so the next
        claim recomputes that number from the highest stage still present. Drop
        the stage here and the new primary would be handed generation 1 - the
        same number, and so the same candidate file, the displaced agent is
        still writing to. Two agents sharing one candidate is the lost update
        this whole boundary exists to exclude.

        Left in place, the stage makes the generation climb, the new primary
        gets its own copy of the last published revision, and the old stage is
        refused at the one commit that reaches the plan. It is also the draft
        the reviewer may choose to hand forward, so destroying it here would
        discard work they were offered a say over.
        */
        return freed;
      },
    });
    if (next !== undefined) released.push(next);
  }
  for (const request of released) {
    await appendProgressEvent({
      store,
      event: {
        sessionId: request.sessionId,
        requestId: request.requestId,
        atMs: nowMs,
        stepCode: "claim-released",
        step,
        state: "done",
        detail,
      },
    }).catch(() => undefined);
  }
  return released;
};

/**
 * Removes one waiting message outright. Cancel and delete are distinct: cancel
 * stops work the agent started, delete removes a message that never started,
 * including one the reviewer already canceled.
 */
export const deleteQueuedRequest = async ({
  store,
  requestId,
  agentConnected,
  clock = Date.now,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  /** Whether the presence lease reports an agent attached right now. */
  readonly agentConnected: boolean;
  readonly clock?: Clock;
}): Promise<AgentRequestDeletionResult> => {
  const nowMs = readClock(clock);
  return withRequestLock({
    store,
    requestId,
    change: async (lockedStore) => {
      const request = await readQueuedMessage({
        store: lockedStore,
        requestId,
        verb: "deleted",
        allowCanceled: true,
        agentConnected,
        nowMs,
      });
      if (request.claimedAt !== undefined) {
        await dropUnpublishableStages({ store: lockedStore, requestId });
      }
      return deleteAgentRequestValue({ store: lockedStore, requestId });
    },
  });
};

/**
 * Removes one comment from a feedback request no agent is holding - because
 * none has claimed it, or because the claim on it is proven abandoned. A
 * request that no longer carries the comment has already had it removed, so the
 * removal answers with the stored request rather than refusing a repeat.
 */
export const removeCommentFromQueuedFeedbackRequest = async ({
  store,
  requestId,
  commentId,
  now,
  agentConnected,
  clock = Date.now,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly commentId: string;
  readonly now: string;
  /** Whether the presence lease reports an agent attached right now. */
  readonly agentConnected: boolean;
  readonly clock?: Clock;
}): Promise<AgentFeedbackRequest> => {
  const nowMs = readClock(clock);
  const { updated, released } = await withRequestLock({
    store,
    requestId,
    change: async (lockedStore) => {
      const request = await assertCommentIsRemovable({
        store: lockedStore,
        request: await readCurrentRequest({ store: lockedStore, requestId }),
        agentConnected,
        nowMs,
      });
      if (request.canceledAt !== undefined) {
        return { updated: request, released: false };
      }
      const comments = request.comments.filter(
        (comment) => comment.id !== commentId,
      );
      if (comments.length === request.comments.length) {
        return { updated: request, released: false };
      }
      // A batch the reviewer has taken a comment out of is no longer the batch
      // the abandoned claim froze, so the claim goes with it. A batch emptied
      // outright is terminal instead, and a terminal request already refuses
      // every answer, so its claim is left as the record of what happened.
      const emptied = comments.length === 0;
      const updated = validateAgentRequest(
        emptied
          ? { ...request, canceledAt: now }
          : { ...withoutClaim(request), comments },
      );
      if (updated.kind !== "feedback") {
        throw new AgentExchangeRejected(
          "Removing a queued comment changed the request kind",
        );
      }
      await writeAgentRequestValue({
        store: lockedStore,
        requestId,
        value: updated,
      });
      // Keeping the claim and keeping its plan candidate are separate
      // decisions. The claim survives an emptied batch as the record of what
      // happened; the candidate does not survive either outcome, because
      // neither a released generation nor a canceled request can publish it.
      const released = request.claimedAt !== undefined && !emptied;
      if (released || emptied) {
        await dropUnpublishableStages({ store: lockedStore, requestId });
      }
      return { updated, released };
    },
  });
  if (released) {
    await announceClaimRelease({
      store,
      request: updated,
      atMs: nowMs,
      ...ABANDONED_CLAIM_RELEASE,
    });
  }
  return updated;
};

/**
 * Proves the reviewer can take back every request that carries one comment
 * before any of them is written.
 *
 * Taking a comment out of the review touches one request at a time, each under
 * its own lock, so a refusal partway through would leave the earlier requests
 * withdrawn for a deletion that never happened - a message the reviewer never
 * asked to withdraw. Reading the same refusals first turns that into one
 * conflict the reviewer can retry once the state resolves.
 *
 * It is a proof, not a lock: the refusals are re-proved where each write
 * happens, and this only removes the case where the caller's own settle step
 * made one of them certain.
 */
export const assertRequestsMayBeTakenBack = async ({
  store,
  requestIds,
  agentConnected,
  clock = Date.now,
}: {
  readonly store: ReviewStore;
  readonly requestIds: ReadonlyArray<string>;
  /** Whether the presence lease reports an agent attached right now. */
  readonly agentConnected: boolean;
  readonly clock?: Clock;
}): Promise<void> => {
  const nowMs = readClock(clock);
  for (const requestId of requestIds) {
    const request = await readCurrentRequest({ store, requestId });
    if (request.kind === "feedback") {
      await assertCommentIsRemovable({
        store,
        request,
        agentConnected,
        nowMs,
      });
      continue;
    }
    await assertRequestIsWithdrawable({ store, request });
  }
};

/**
 * Refuses a resolve that would contradict outstanding work. Resolution and an
 * unanswered message are mutually exclusive states, so the thread must reach
 * one of them first: cancel the message, or wait for the answer.
 */
export const assertResolvableComment = async ({
  store,
  sessionId,
  planId,
  commentId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly commentId: string;
}): Promise<void> => {
  const history = await readAgentCommentHistory({
    store,
    sessionId,
    planId,
    commentId,
  });
  if (outstandingAgentRequests(history).length === 0) return;
  throw new AgentExchangeRejected(
    "This comment has a message waiting for the coding agent. Cancel the message or wait for its answer before resolving.",
  );
};

export type ProgressEventDraft = Omit<ProgressEvent, "seq">;

/** Allocates and appends one progress event while its sequence is locked. */
export const appendProgressEvent = async ({
  store,
  event,
}: {
  readonly store: ReviewStore;
  readonly event: ProgressEventDraft;
}): Promise<ProgressEvent> => {
  if (!REQUEST_ID.test(event.sessionId)) {
    throw new AgentExchangeRejected(
      "A session id must be 16 hexadecimal characters",
    );
  }
  // The lock names the file, not the session writing to it. A per-session lock
  // let two sessions append to one log at once, and it could not make
  // compaction safe, because compaction replaces the file every appender
  // shares.
  return withReviewStoreLock({
    lockPath: join(store.reviewDirectory, ".progress.lock"),
    change: async () => {
      const seq = await nextProgressSequence({
        store,
        sessionId: event.sessionId,
      });
      const checked = { ...event, seq };
      await appendProgressValue({ store, event: checked });
      // Compaction reclaims space in a log this append has already joined. It
      // is not part of the append's contract, so a full disk or a permission
      // error leaves the log longer than it needs to be rather than reporting
      // a successful append as a failure the caller would retry.
      await compactProgressLog({ store }).catch(() => undefined);
      return checked;
    },
    timeoutError: () =>
      new AgentExchangeRejected(
        "Another process is updating agent progress. Try again.",
      ),
  });
};

/**
 * Appends a connection edge once, even when several checks see it.
 *
 * A connection that has already stopped can still be explained better than it
 * was. An agent that goes quiet is recorded as silence, and the reviewer may
 * then end that session outright - so the log takes a second edge at the same
 * state when the new reason supersedes the recorded one, and the end the
 * reviewer asked for is stated as one rather than left as the gap that preceded
 * it (BIG-156, BIG-190). Every other repeat still writes nothing.
 */
export const recordAgentConnectionState = async ({
  store,
  sessionId,
  connected,
  at,
  disconnectReason,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly connected: boolean;
  readonly at: string;
  readonly disconnectReason: string;
}): Promise<boolean> => {
  if (!REQUEST_ID.test(sessionId)) {
    throw new AgentExchangeRejected(
      "A session id must be 16 hexadecimal characters",
    );
  }
  return withReviewStoreLock({
    lockPath: join(
      store.agentConnectionDirectory,
      `.${sessionId}.connection.lock`,
    ),
    change: async () => {
      const events = await readAgentConnectionEvents({
        store,
        sessionId,
      });
      const last = events.at(-1);
      const previous = last?.connected;
      const explainsItBetter =
        !connected &&
        agentConnectionReasonSupersedes({
          ...(last?.reason === undefined ? {} : { recorded: last.reason }),
          next: disconnectReason,
        });
      if (previous === connected && !explainsItBetter) return false;
      await appendAgentConnectionEvent({
        store,
        event: {
          sessionId,
          connected,
          at,
          // A first edge names no reason because nothing stopped before it.
          // Every later edge that reports a connection ending carries the
          // account it is being recorded for, including the second one this
          // rule allows.
          ...(previous !== undefined && !connected
            ? { reason: disconnectReason }
            : {}),
        },
      });
      return true;
    },
    timeoutError: () =>
      new AgentExchangeRejected(
        "Another process is updating agent presence. Try again.",
      ),
  });
};
