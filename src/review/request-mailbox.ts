// Owns changes to stored agent requests. Each change locks one request,
// reads its current value, validates it, and writes one complete replacement.

import { join } from "node:path";
import {
  AgentExchangeRejected,
  readValidatedAgentResponse,
  validateAgentRequest,
} from "./agent-exchange.js";
import type {
  AgentFeedbackRequest,
  AgentRequest,
  AgentResponse,
} from "./agent-exchange.js";
import {
  appendAgentConnectionEvent,
  appendProgressValue,
  readAgentConnectionEvents,
  readAgentRequestValue,
  readProgress,
  withReviewStoreLock,
  writeAgentRequestValue,
  writeAgentResponseValue,
} from "./store.js";
import type { ProgressEvent, ReviewStore } from "./store.js";

const REQUEST_ID = /^[a-f0-9]{16}$/;

/** Runs one request change while the request file is locked. */
const withRequestLock = async <TResult>({
  store,
  requestId,
  change,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly change: () => Promise<TResult>;
}): Promise<TResult> => {
  if (!REQUEST_ID.test(requestId)) {
    throw new AgentExchangeRejected(
      "A request id must be 16 hexadecimal characters",
    );
  }
  return withReviewStoreLock({
    lockPath: join(store.agentRequestDirectory, `.${requestId}.lock`),
    change,
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
    change: async () => {
      const value = await readAgentRequestValue({
        store,
        requestId: intended.requestId,
      });
      if (value === undefined) {
        await writeAgentRequestValue({
          store,
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
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly baselineSnapshot: string;
  readonly now: string;
}): Promise<AgentRequest> =>
  withRequestLock({
    store,
    requestId,
    change: async () => {
      const request = await readCurrentRequest({ store, requestId });
      if (request.canceledAt !== undefined) {
        throw new AgentExchangeRejected(
          "The request was canceled by the reviewer",
        );
      }
      if (request.baselineSnapshot !== undefined) return request;
      const claimed = validateAgentRequest({
        ...request,
        baselineSnapshot,
        claimedAt: now,
      });
      await writeAgentRequestValue({ store, requestId, value: claimed });
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
    change: async () => {
      const request = await readCurrentRequest({ store, requestId });
      if (request.canceledAt !== undefined) return request;
      if (
        (await readValidatedAgentResponse({ store, request })) !== undefined
      ) {
        throw new AgentExchangeRejected(
          "The agent has already answered this request",
        );
      }
      const canceled = validateAgentRequest({ ...request, canceledAt: now });
      await writeAgentRequestValue({ store, requestId, value: canceled });
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
    change: async () => {
      const request = await readCurrentRequest({
        store,
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
      if (!responseMatchesRequest({ value: response, request })) {
        throw new AgentExchangeRejected(
          "The agent response does not match its request",
        );
      }
      if (
        (await readValidatedAgentResponse({ store, request })) !== undefined
      ) {
        throw new AgentExchangeRejected(
          "The agent has already answered this request",
        );
      }
      await writeAgentResponseValue({
        store,
        requestId: response.requestId,
        value: response,
      });
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
    change: async () => {
      const request = await readCurrentRequest({ store, requestId });
      if (request.kind !== "feedback") {
        throw new AgentExchangeRejected(
          "Only a feedback request can remove a queued comment",
        );
      }
      if (request.claimedAt !== undefined) {
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
      await writeAgentRequestValue({ store, requestId, value: updated });
      return updated;
    },
  });

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
  return withReviewStoreLock({
    lockPath: join(store.reviewDirectory, `.${event.sessionId}.progress.lock`),
    change: async () => {
      const events = await readProgress({ store, sessionId: event.sessionId });
      const seq =
        events.reduce((highest, entry) => Math.max(highest, entry.seq), 0) + 1;
      const checked = { ...event, seq };
      await appendProgressValue({ store, event: checked });
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
