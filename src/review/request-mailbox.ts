// Owns changes to stored agent requests. Each change locks one request,
// reads its current value, validates it, and writes one complete replacement.

import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AgentExchangeRejected,
  validateAgentRequest,
} from "./agent-exchange.js";
import type { AgentFeedbackRequest, AgentRequest } from "./agent-exchange.js";
import {
  appendAgentConnectionEvent,
  appendProgressValue,
  readAgentConnectionEvents,
  readAgentRequestValue,
  readProgress,
  writeAgentRequestValue,
} from "./store.js";
import type { ProgressEvent, ReviewStore } from "./store.js";

const LOCK_ATTEMPTS = 200;
const LOCK_WAIT_MS = 10;
const REQUEST_ID = /^[a-f0-9]{16}$/;
const LOCK_OWNER_FILE = "owner.json";

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

const processIsRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !hasCode(error, "ESRCH");
  }
};

/** Removes a lock only when its recorded process no longer exists. */
const clearAbandonedLock = async (lockPath: string): Promise<void> => {
  const ownerPath = join(lockPath, LOCK_OWNER_FILE);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(ownerPath, "utf8"));
  } catch {
    return;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("pid" in value) ||
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    processIsRunning(value.pid)
  ) {
    return;
  }
  try {
    // Only one waiter can remove the owner file. Other waiters leave any new
    // non-empty lock alone.
    await unlink(ownerPath);
    await rmdir(lockPath);
  } catch (error: unknown) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
};

/** Creates one cross-process lock and records the process that owns it. */
const acquireMailboxLock = async (lockPath: string): Promise<boolean> => {
  try {
    await mkdir(lockPath, { mode: 0o700 });
  } catch (error: unknown) {
    if (!hasCode(error, "EEXIST")) throw error;
    await clearAbandonedLock(lockPath);
    return false;
  }
  try {
    await writeFile(
      join(lockPath, LOCK_OWNER_FILE),
      `${JSON.stringify({ pid: process.pid })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    return true;
  } catch (error: unknown) {
    await rmdir(lockPath).catch(() => undefined);
    throw error;
  }
};

/** Releases the exact lock owned by this process. */
const releaseMailboxLock = async (lockPath: string): Promise<void> => {
  await unlink(join(lockPath, LOCK_OWNER_FILE));
  await rmdir(lockPath);
};

/** Runs one mailbox change while other processes wait for the same resource. */
const withMailboxLock = async <TResult>({
  lockPath,
  change,
}: {
  readonly lockPath: string;
  readonly change: () => Promise<TResult>;
}): Promise<TResult> => {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    if (!(await acquireMailboxLock(lockPath))) {
      await wait();
      continue;
    }
    try {
      return await change();
    } finally {
      await releaseMailboxLock(lockPath);
    }
  }
  throw new AgentExchangeRejected(
    "Another process is changing this request. Try again.",
  );
};

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
  return withMailboxLock({
    lockPath: join(store.agentRequestDirectory, `.${requestId}.lock`),
    change,
  });
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
  return withMailboxLock({
    lockPath: join(store.reviewDirectory, `.${event.sessionId}.progress.lock`),
    change: async () => {
      const events = await readProgress({ store, sessionId: event.sessionId });
      const seq =
        events.reduce((highest, entry) => Math.max(highest, entry.seq), 0) + 1;
      const checked = { ...event, seq };
      await appendProgressValue({ store, event: checked });
      return checked;
    },
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
  return withMailboxLock({
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
  });
};
