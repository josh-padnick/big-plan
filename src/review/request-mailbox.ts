// Owns locked changes to stored agent requests and the plan-wide claim gate.
// Request creation is the only place new work can land, so it also clears
// resolution for any thread that work names - resolution and outstanding work
// stay mutually exclusive from both directions.

import { join } from "node:path";
import {
  AgentExchangeRejected,
  outstandingAgentRequests,
  readAgentCommentHistory,
  readAgentExchange,
  readValidatedAgentRequests,
  requestBlocksPlanPickup,
  requestIsTerminal,
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
import {
  anchorReviewStore,
  appendAgentConnectionEvent,
  appendProgressValue,
  compactProgressLog,
  deleteAgentRequestValue,
  nextProgressSequence,
  readAgentConnectionEvents,
  readAgentRequestValue,
  readResolvedCommentIds,
  ReviewStorePathRejected,
  withReviewStoreLock,
  writeAgentRequestValue,
  writeAgentResponseValue,
  writeResolvedCommentIds,
} from "./store.js";
import {
  claimIsHeldByAnother,
  claimIsLive,
  claimLeaseExpiryMs,
} from "./shared/agent-claim.js";
import { validateResolvedCommentIds } from "./shared/comment.js";
import type { AgentModelIdentity } from "./shared/agent-model.js";
import type {
  AgentRequestDeletionResult,
  ProgressEvent,
  ReviewStore,
} from "./store.js";

const REQUEST_ID = /^[a-f0-9]{16}$/;

/** Comment threads a request can reopen by creating outstanding work. */
const namedCommentIds = (request: AgentRequest): ReadonlyArray<string> =>
  request.kind === "feedback"
    ? request.comments.map((comment) => comment.id)
    : request.kind === "reply"
      ? [request.commentId]
      : [];

/**
 * Serializes resolved-set mutations so a request create and a drafts persist
 * cannot interleave into outstanding work on a still-resolved thread.
 */
const withResolvedCommentLock = async <TResult>({
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
    lockPath: join(lockedStore.reviewDirectory, ".resolved.lock"),
    change: () => change(lockedStore),
    timeoutError: () =>
      new AgentExchangeRejected(
        "Another process is updating resolved threads. Try again.",
      ),
    invalidLockError: () =>
      new AgentExchangeRejected("The request mailbox is unavailable"),
  });
};

/**
 * Drops the named threads from the resolved set. The request file carries the
 * matching reopen records, so a crash after that write still cannot leave
 * outstanding work looking resolved.
 */
const clearResolvedComments = async ({
  store,
  commentIds,
}: {
  readonly store: ReviewStore;
  readonly commentIds: ReadonlyArray<string>;
}): Promise<ReadonlyArray<string>> => {
  if (commentIds.length === 0) return [];
  const current = await readResolvedCommentIds({
    store,
    validate: validateResolvedCommentIds,
  });
  const named = new Set(commentIds);
  const remaining = current.filter((commentId) => !named.has(commentId));
  const reopened = current.filter((commentId) => named.has(commentId));
  if (reopened.length === 0) return [];
  await writeResolvedCommentIds({ store, ids: remaining });
  return reopened;
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
    timeoutError: () =>
      new AgentExchangeRejected(
        "Another process is changing this request. Try again.",
      ),
    invalidLockError: () =>
      new AgentExchangeRejected("The request mailbox is unavailable"),
  });
};

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
  value.version === 2 &&
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
  delete created.answeredAt;
  delete created.canceledAt;
  delete created.reopenedCommentIds;
  return JSON.stringify(created);
};

/**
 * Writes one request, or returns the stored copy of an identical retry.
 * Accepting new or still-outstanding work for a resolved thread writes the
 * reopen records onto the request first, then clears those ids from the
 * resolved set in the same lock.
 */
export const ensureAgentRequest = async ({
  store,
  request,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
}): Promise<AgentRequest> => {
  const intended = validateAgentRequest(request);
  const commentIds = namedCommentIds(intended);
  const accept = async (lockedStore: ReviewStore): Promise<AgentRequest> => {
    const value = await readAgentRequestValue({
      store: lockedStore,
      requestId: intended.requestId,
    });
    let accepted = intended;
    if (value !== undefined) {
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
      if (requestIsTerminal(existing)) return existing;
      accepted = existing;
    }
    if (commentIds.length === 0) {
      if (value === undefined) {
        await writeAgentRequestValue({
          store: lockedStore,
          requestId: intended.requestId,
          value: intended,
        });
      }
      return accepted;
    }
    const currentResolved = await readResolvedCommentIds({
      store: lockedStore,
      validate: validateResolvedCommentIds,
    });
    const newlyReopened = currentResolved.filter((commentId) =>
      commentIds.includes(commentId),
    );
    const reopenedCommentIds = [
      ...new Set([...(accepted.reopenedCommentIds ?? []), ...newlyReopened]),
    ];
    const recorded =
      reopenedCommentIds.length === 0
        ? accepted
        : validateAgentRequest({ ...accepted, reopenedCommentIds });
    if (value === undefined || newlyReopened.length > 0) {
      await writeAgentRequestValue({
        store: lockedStore,
        requestId: intended.requestId,
        value: recorded,
      });
    }
    await clearResolvedComments({
      store: lockedStore,
      commentIds: newlyReopened,
    });
    return recorded;
  };
  return commentIds.length === 0
    ? withRequestLock({
        store,
        requestId: intended.requestId,
        change: accept,
      })
    : withResolvedCommentLock({
        store,
        change: (resolvedStore) =>
          withRequestLock({
            store: resolvedStore,
            requestId: intended.requestId,
            change: accept,
          }),
      });
};

/**
 * Takes or renews one agent session's exclusive claim on a request, freezing
 * the source baseline the claim's work will be diffed against.
 *
 * The claim is an ownership lease, not just a baseline freeze. The plan claim
 * lock permits one live request claim across the plan, and the request lock
 * decides renewal, contention, and takeover for the selected request. A
 * lapsed lease during a long edit can still interleave plan writes until write
 * fencing exists.
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
          // The new durable claim fences claims and answers, not plan writes
          // the lapsed holder may already have started before write fencing.
          const claimed = validateAgentRequest({
            ...request,
            baselineSnapshot,
            claimedAt: now,
            claimedBy,
            claimedModel: model,
            claimExpiresAtMs: claimLeaseExpiryMs(nowMs),
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
          "The previous agent stopped responding; its partial plan edits may interleave with this takeover until write fencing exists",
      },
    }).catch(() => undefined);
  }
  return takeover.request;
};

/**
 * Marks one request terminal. A later pickup or response cannot revive it.
 * A fresh cancel clears the request's reopened threads from the stored
 * resolved set before the cancel write, so a crash between the request write
 * and the create-time clear cannot resurrect a stale resolution, while a
 * retry of an already-canceled request never touches the resolved set and a
 * resolve recorded after the first cancel survives.
 */
export const cancelAgentRequest = async ({
  store,
  requestId,
  now,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly now: string;
}): Promise<AgentRequest> =>
  withResolvedCommentLock({
    store,
    change: (resolvedStore) =>
      withRequestLock({
        store: resolvedStore,
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
          await clearResolvedComments({
            store: lockedStore,
            commentIds: request.reopenedCommentIds ?? [],
          });
          const canceled = validateAgentRequest({
            ...request,
            canceledAt: now,
          });
          await writeAgentRequestValue({
            store: lockedStore,
            requestId,
            value: canceled,
          });
          return canceled;
        },
      }),
  });

/**
 * Answers one request and marks it terminal as a single commit. Leaving the
 * outstanding set also clears the request's reopened threads from the stored
 * resolved set, so a crash between the request write and the create-time clear
 * cannot resurrect a stale resolution once the work is answered.
 */
export const commitRequestTerminal = async ({
  store,
  response,
  claimedBy,
  now,
  clock = Date.now,
}: {
  readonly store: ReviewStore;
  readonly response: AgentResponse;
  readonly claimedBy: string;
  readonly now: string;
  readonly clock?: Clock;
}): Promise<AgentRequest> =>
  withResolvedCommentLock({
    store,
    change: (resolvedStore) =>
      withRequestLock({
        store: resolvedStore,
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
          // Only the holder may answer. Without this the lease would guard pickup
          // but not delivery, and a session that lost its claim could still
          // overwrite the holder's work at the last step.
          const nowMs = readClock(clock);
          if (
            request.claimedBy !== claimedBy ||
            !claimIsLive({ request, nowMs })
          ) {
            throw new AgentExchangeRejected(
              "This agent session does not hold a live claim on this request",
            );
          }
          if (!responseMatchesRequest({ value: response, request })) {
            throw new AgentExchangeRejected(
              "The agent response does not match its request",
            );
          }
          const answered = validateAgentRequest({
            ...request,
            answeredAt: now,
          });
          await writeAgentResponseValue({
            store: lockedStore,
            requestId: response.requestId,
            value: response,
          });
          await writeAgentRequestValue({
            store: lockedStore,
            requestId: response.requestId,
            value: answered,
          });
          await clearResolvedComments({
            store: lockedStore,
            commentIds: answered.reopenedCommentIds ?? [],
          });
          return answered;
        },
      }),
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
 *
 * Deleting a still-queued message clears its reopened threads from the stored
 * resolved set before the request file - the recoverable reopen commit - is
 * destroyed. A canceled message already cleared them when it was canceled, so
 * deleting one leaves the resolved set alone.
 */
export const deleteQueuedRequest = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<AgentRequestDeletionResult> =>
  withResolvedCommentLock({
    store,
    change: (resolvedStore) =>
      withRequestLock({
        store: resolvedStore,
        requestId,
        change: async (lockedStore) => {
          const request = await readQueuedMessage({
            store: lockedStore,
            requestId,
            verb: "deleted",
            allowCanceled: true,
          });
          if (request.canceledAt === undefined) {
            await clearResolvedComments({
              store: lockedStore,
              commentIds: request.reopenedCommentIds ?? [],
            });
          }
          return deleteAgentRequestValue({ store: lockedStore, requestId });
        },
      }),
  });

/** Removes one comment before an agent claims its feedback request. */
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
      if (comments.length === request.comments.length) {
        throw new AgentExchangeRejected(
          "The queued feedback request does not contain this comment",
        );
      }
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
 * Replaces the resolved-thread set after refusing any new resolve that would
 * contradict outstanding work. Already-resolved ids are skipped so unrelated
 * review state can persist.
 */
export const replaceResolvedCommentIds = async ({
  store,
  sessionId,
  planId,
  ids,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly ids: ReadonlyArray<string>;
}): Promise<void> =>
  withResolvedCommentLock({
    store,
    change: async (lockedStore) => {
      const alreadyResolved = new Set(
        await readResolvedCommentIds({
          store: lockedStore,
          validate: validateResolvedCommentIds,
        }),
      );
      for (const commentId of ids) {
        if (alreadyResolved.has(commentId)) continue;
        await assertResolvableComment({
          store: lockedStore,
          sessionId,
          planId,
          commentId,
        });
      }
      await writeResolvedCommentIds({ store: lockedStore, ids });
    },
  });

/**
 * Drops threads from the resolved set under the same lock every other stored
 * resolved-set mutation takes, so a removal cannot interleave with a request
 * create's reopen commit and write a stale resolution back.
 */
export const removeResolvedComments = async ({
  store,
  commentIds,
}: {
  readonly store: ReviewStore;
  readonly commentIds: ReadonlyArray<string>;
}): Promise<void> => {
  if (commentIds.length === 0) return;
  await withResolvedCommentLock({
    store,
    change: async (lockedStore) => {
      await clearResolvedComments({ store: lockedStore, commentIds });
    },
  });
};

/**
 * Stored resolved ids minus any still suppressed by outstanding reopen
 * records. Readers use this so a crash between the request write and the
 * resolved-set write cannot show outstanding work as resolved.
 */
export const readEffectiveResolvedCommentIds = async ({
  store,
  sessionId,
  planId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
}): Promise<ReadonlyArray<string>> => {
  const [stored, exchange] = await Promise.all([
    readResolvedCommentIds({
      store,
      validate: validateResolvedCommentIds,
    }),
    readAgentExchange({ store, sessionId, planId }),
  ]);
  const suppressed = new Set(
    outstandingAgentRequests(exchange).flatMap((request) => [
      ...(request.reopenedCommentIds ?? []),
      ...namedCommentIds(request),
    ]),
  );
  return stored.filter((commentId) => !suppressed.has(commentId));
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
