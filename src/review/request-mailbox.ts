// Owns locked changes to stored agent requests and the plan-wide claim gate.
// Request creation and resolution share `.resolved.lock`, so a resolve and a
// new reply or feedback cannot interleave into a resolved thread that holds
// outstanding work.

import { join } from "node:path";
import {
  AgentExchangeRejected,
  outstandingAgentRequests,
  readAgentCommentHistory,
  readValidatedAgentRequests,
  requestBaselineSnapshot,
  requestBlocksPlanPickup,
  validateAgentRequest,
} from "./agent-exchange.js";
import type {
  AgentChatRequest,
  AgentFeedbackRequest,
  AgentReplyRequest,
  AgentRequest,
  AgentResponse,
} from "./agent-exchange.js";
import {
  deduplicateReviewImageReferences,
  extractReviewImageReferences,
} from "./shared/review-image.js";
import { agentOwnsRequest } from "./shared/request-ownership.js";
import { validateResolvedCommentIds } from "./shared/comment.js";
import { RESOLVED_THREAD_NEW_WORK_ERROR } from "./shared/resolved-thread-work.js";
import {
  anchorReviewStore,
  appendAgentConnectionEvent,
  appendProgressValue,
  compactProgressLog,
  deleteAgentRequestValue,
  hasPreparedMutationJournal,
  nextProgressSequence,
  readAgentConnectionEvents,
  readAgentRequestValue,
  readResolvedCommentIds,
  removeAgentMutationStages,
  ReviewStorePathRejected,
  withReviewStoreLock,
  writeAgentRequestValue,
  writeAgentResponseValue,
} from "./store.js";
import {
  changeSetIdsFor,
  recordCommittedRevision,
} from "./change-set-commit.js";
import type { CommittedPlanRevision } from "./change-set-commit.js";
import {
  claimIsHeldByAnother,
  claimLeaseExpiryMs,
} from "./shared/agent-claim.js";
import type { AgentModelIdentity } from "./shared/agent-model.js";
import type {
  AgentRequestDeletionResult,
  ProgressEvent,
  ReviewStore,
} from "./store.js";

const REQUEST_ID = /^[a-f0-9]{16}$/;

const namedCommentIds = (request: AgentRequest): ReadonlyArray<string> =>
  request.kind === "feedback"
    ? request.comments.map((comment) => comment.id)
    : request.kind === "reply"
      ? [request.commentId]
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

const withPlanClaimLock = async <TResult>({
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

const requestCreation = (request: AgentRequest): string => {
  const created: Record<string, unknown> = { ...request };
  delete created.baselineSnapshot;
  delete created.claimedAt;
  delete created.claimedBy;
  delete created.claimedModel;
  delete created.claimExpiresAtMs;
  delete created.claimGeneration;
  delete created.answeredAt;
  delete created.canceledAt;
  return JSON.stringify(created);
};

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
          if (request.claimedBy === claimedBy) {
            const renewed = validateAgentRequest({
              ...request,
              claimedModel: model ?? request.claimedModel,
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
          const requests = await readValidatedAgentRequests({
            store: lockedStore,
            sessionId: activeSessionId,
            planId: request.planId,
          });
          if (
            requests.some(
              (candidate) =>
                candidate.requestId !== requestId &&
                requestBlocksPlanPickup({ request: candidate, nowMs }),
            )
          ) {
            throw new AgentClaimContended(
              "Another agent session is working on this plan",
            );
          }
          // A takeover is a new claim, so it raises the generation. The
          // displaced holder keeps writing to a stage whose generation the
          // commit boundary no longer accepts.
          const claimed = validateAgentRequest({
            ...request,
            baselineSnapshot,
            claimedAt: now,
            claimedBy,
            claimedModel: model,
            claimExpiresAtMs: claimLeaseExpiryMs(nowMs),
            claimGeneration: (request.claimGeneration ?? 0) + 1,
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

/** Marks one request terminal. A later pickup or response cannot revive it. */
export const cancelAgentRequest = async ({
  store,
  requestId,
  now,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly now: string;
}): Promise<AgentRequest> =>
  withRequestLock({
    store,
    requestId,
    change: async (lockedStore) => {
      const request = await readCurrentRequest({
        store: lockedStore,
        requestId,
      });
      if (request.canceledAt !== undefined) return request;
      if (request.answeredAt !== undefined) {
        throw new AgentExchangeRejected(
          "The agent has already answered this request",
        );
      }
      // The commit writes its journal under this same request lock, so a
      // journal on disk here means the answer has published or is one rename
      // from publishing. Withdrawing it would leave the plan carrying a
      // revision every record calls canceled.
      if (await hasPreparedMutationJournal({ store: lockedStore, requestId })) {
        throw new AgentExchangeRejected(
          "The agent's answer for this request is already publishing, so it can no longer be canceled",
        );
      }
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

/** Describes one committed revision to the Change Engine's change sets. */
const committedRevisionOf = ({
  request,
  response,
  at,
}: {
  readonly request: AgentRequest;
  readonly response: AgentResponse;
  readonly at: string;
}): CommittedPlanRevision => ({
  requestId: response.requestId,
  changeSetIds: changeSetIdsFor(response),
  baseSnapshot: requestBaselineSnapshot(request),
  resultSnapshot: response.resultSnapshot,
  provenance: response.kind,
  committedAt: at,
});

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
        throw new AgentExchangeRejected(
          "The request must be claimed before it can be answered",
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
      await recordCommittedRevision({
        store: lockedStore,
        revision: committedRevisionOf({ request, response, at: now }),
      });
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
      await recordCommittedRevision({
        store: lockedStore,
        revision: committedRevisionOf({ request: answered, response, at: now }),
      });
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
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly verb: string;
  readonly allowCanceled: boolean;
}): Promise<AgentReplyRequest | AgentChatRequest> => {
  const request = await readCurrentRequest({ store, requestId });
  if (request.kind === "feedback") {
    throw new AgentExchangeRejected(
      `Only a reply or plan question can be ${verb} while it waits`,
    );
  }
  if (!allowCanceled && request.canceledAt !== undefined) {
    throw new AgentExchangeRejected("The request was canceled by the reviewer");
  }
  if (agentOwnsRequest(request)) {
    throw new AgentExchangeRejected(AGENT_STARTED);
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
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly body: string;
}): Promise<AgentReplyRequest | AgentChatRequest> =>
  withRequestLock({
    store,
    requestId,
    change: async (lockedStore) => {
      const request = await readQueuedMessage({
        store: lockedStore,
        requestId,
        verb: "revised",
        allowCanceled: false,
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
      const revised = validateAgentRequest({ ...request, body, attachments });
      if (revised.kind === "feedback") {
        throw new AgentExchangeRejected(
          "Revising this message changed the request kind",
        );
      }
      await writeAgentRequestValue({
        store: lockedStore,
        requestId,
        value: revised,
      });
      return revised;
    },
  });

/**
 * Removes one waiting message outright. Cancel and delete are distinct: cancel
 * stops work the agent started, delete removes a message that never started,
 * including one the reviewer already canceled.
 */
export const deleteQueuedRequest = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<AgentRequestDeletionResult> =>
  withRequestLock({
    store,
    requestId,
    change: async (lockedStore) => {
      await readQueuedMessage({
        store: lockedStore,
        requestId,
        verb: "deleted",
        allowCanceled: true,
      });
      return deleteAgentRequestValue({ store: lockedStore, requestId });
    },
  });

/**
 * Removes one comment before an agent claims its feedback request. A request
 * that no longer carries the comment has already had it removed, so the
 * removal answers with the stored request rather than refusing a repeat.
 */
export const removeCommentFromQueuedFeedbackRequest = async ({
  store,
  requestId,
  commentId,
  now,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly commentId: string;
  readonly now: string;
}): Promise<AgentFeedbackRequest> =>
  withRequestLock({
    store,
    requestId,
    change: async (lockedStore) => {
      const request = await readCurrentRequest({
        store: lockedStore,
        requestId,
      });
      if (request.kind !== "feedback") {
        throw new AgentExchangeRejected(
          "Only a feedback request can remove a queued comment",
        );
      }
      if (agentOwnsRequest(request)) {
        throw new AgentExchangeRejected(
          "The agent has already picked up this feedback request",
        );
      }
      if (request.canceledAt !== undefined) return request;
      const comments = request.comments.filter(
        (comment) => comment.id !== commentId,
      );
      if (comments.length === request.comments.length) return request;
      const updated = validateAgentRequest(
        comments.length === 0
          ? { ...request, canceledAt: now }
          : { ...request, comments },
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
      return updated;
    },
  });

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
      await compactProgressLog({ store });
      return checked;
    },
    timeoutError: () =>
      new AgentExchangeRejected(
        "Another process is updating agent progress. Try again.",
      ),
  });
};

/** Appends a connection edge once, even when several checks see it. */
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
      const previous = events.at(-1)?.connected;
      if (previous === connected) return false;
      await appendAgentConnectionEvent({
        store,
        event: {
          sessionId,
          connected,
          at,
          ...(previous === true && !connected
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
