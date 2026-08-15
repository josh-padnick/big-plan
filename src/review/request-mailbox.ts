// Owns stored agent-request lifecycle mutations and invariants. Each mutation
// locks its state, validates it, and writes one complete replacement.

import { join } from "node:path";
import {
  AgentExchangeRejected,
  outstandingAgentRequests,
  readAgentCommentHistory,
  readValidatedAgentResponse,
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
  ReviewStorePathRejected,
  withReviewStoreLock,
  writeAgentRequestValue,
  writeAgentResponseValue,
} from "./store.js";
import type {
  AgentRequestDeletionResult,
  ProgressEvent,
  ReviewStore,
} from "./store.js";

const REQUEST_ID = /^[a-f0-9]{16}$/;

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
  let requestDirectory: string;
  try {
    const anchoredStore = await anchorReviewStore(store);
    requestDirectory = (
      await anchoredStore.resolveAgentPath({ area: "requests" })
    ).path;
  } catch (error: unknown) {
    if (!(error instanceof ReviewStorePathRejected)) throw error;
    throw new AgentExchangeRejected("The request mailbox is unavailable");
  }
  const lockedStore = { ...store, agentRequestDirectory: requestDirectory };
  return withReviewStoreLock({
    lockPath: join(requestDirectory, `.${requestId}.lock`),
    change: () => change(lockedStore),
    timeoutError: () =>
      new AgentExchangeRejected(
        "Another process is changing this request. Try again.",
      ),
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
        await writeAgentRequestValue({
          store: lockedStore,
          requestId: intended.requestId,
          value: intended,
        });
        return intended;
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

/** Freezes the source baseline when an agent first claims a request. */
export const claimAgentRequest = async ({
  store,
  requestId,
  baselineSnapshot,
  now,
  verifyBeforeClaim,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly baselineSnapshot: string;
  readonly now: string;
  readonly verifyBeforeClaim?: (request: AgentRequest) => Promise<void>;
}): Promise<AgentRequest> =>
  withRequestLock({
    store,
    requestId,
    change: async (lockedStore) => {
      const request = await readCurrentRequest({
        store: lockedStore,
        requestId,
      });
      if (request.canceledAt !== undefined) {
        throw new AgentExchangeRejected(
          "The request was canceled by the reviewer",
        );
      }
      if (
        (await readValidatedAgentResponse({
          store: lockedStore,
          request,
        })) !== undefined
      ) {
        throw new AgentExchangeRejected(
          "The agent has already answered this request",
        );
      }
      await verifyBeforeClaim?.(request);
      if (request.baselineSnapshot !== undefined) return request;
      const claimed = validateAgentRequest({
        ...request,
        baselineSnapshot,
        claimedAt: now,
      });
      await writeAgentRequestValue({
        store: lockedStore,
        requestId,
        value: claimed,
      });
      return claimed;
    },
  });

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
      if (
        (await readValidatedAgentResponse({
          store: lockedStore,
          request,
        })) !== undefined
      ) {
        throw new AgentExchangeRejected(
          "The agent has already answered this request",
        );
      }
      const canceled = validateAgentRequest({ ...request, canceledAt: now });
      await writeAgentRequestValue({
        store: lockedStore,
        requestId,
        value: canceled,
      });
      return canceled;
    },
  });

/** Publishes one response only while its request remains answerable. */
export const publishAgentResponse = async ({
  store,
  response,
}: {
  readonly store: ReviewStore;
  readonly response: AgentResponse;
}): Promise<void> =>
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
        !agentOwnsRequest(request) ||
        request.baselineSnapshot === undefined
      ) {
        throw new AgentExchangeRejected(
          "The request must be claimed before it can be answered",
        );
      }
      if (!responseMatchesRequest({ value: response, request })) {
        throw new AgentExchangeRejected(
          "The agent response does not match its request",
        );
      }
      if (
        (await readValidatedAgentResponse({
          store: lockedStore,
          request,
        })) !== undefined
      ) {
        throw new AgentExchangeRejected(
          "The agent has already answered this request",
        );
      }
      await writeAgentResponseValue({
        store: lockedStore,
        requestId: response.requestId,
        value: response,
      });
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
  if ((await readValidatedAgentResponse({ store, request })) !== undefined) {
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
