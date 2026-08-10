// Owns changes to stored agent requests. Each change locks one request,
// reads its current value, validates it, and writes one complete replacement.

import { mkdir, rmdir } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentExchangeRejected,
  validateAgentRequest,
} from "./agent-exchange.js";
import type { AgentFeedbackRequest, AgentRequest } from "./agent-exchange.js";
import { readAgentRequestValue, writeAgentRequestValue } from "./store.js";
import type { ReviewStore } from "./store.js";

const LOCK_ATTEMPTS = 200;
const LOCK_WAIT_MS = 10;
const REQUEST_ID = /^[a-f0-9]{16}$/;

const wait = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, LOCK_WAIT_MS);
  });
};

const hasCode = (
  error: unknown,
  code: string,
): error is Error & { readonly code: string } =>
  error instanceof Error && "code" in error && error.code === code;

/** Runs one request change while other processes wait for the same request. */
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
  const lockPath = join(store.agentRequestDirectory, `.${requestId}.lock`);
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
    } catch (error: unknown) {
      if (!hasCode(error, "EEXIST")) {
        throw error;
      }
      await wait();
      continue;
    }
    try {
      return await change();
    } finally {
      await rmdir(lockPath);
    }
  }
  throw new AgentExchangeRejected(
    "Another process is changing this request. Try again.",
  );
};

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

/** Freezes the source baseline when an agent first claims a request. */
export const claimAgentRequest = async ({
  store,
  requestId,
  sourceRevision: claimedFromRevision,
  now,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly sourceRevision: string;
  readonly now: string;
}): Promise<AgentRequest> =>
  withRequestLock({
    store,
    requestId,
    change: async () => {
      const request = await readCurrentRequest({ store, requestId });
      if (request.claimedFromRevision !== undefined) return request;
      const claimed = validateAgentRequest({
        ...request,
        claimedFromRevision,
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
      const canceled = validateAgentRequest({ ...request, canceledAt: now });
      await writeAgentRequestValue({ store, requestId, value: canceled });
      return canceled;
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
