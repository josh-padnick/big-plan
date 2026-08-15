// Owns stored agent-request lifecycle mutations and invariants. Each mutation
// locks its state, validates it, and writes one complete replacement.

import { join } from "node:path";
import {
  AgentExchangeRejected,
  outstandingAgentRequests,
  readAgentCommentHistory,
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
  readAgentAcceptedSnapshotValue,
  readAgentConnectionEvents,
  readAgentRequestValue,
  readSnapshot,
  ReviewStorePathRejected,
  withReviewStoreLock,
  writeAgentRequestValue,
  writeAgentAcceptedSnapshotValue,
  writeAgentResponseValue,
} from "./store.js";
import { diffWords } from "./snapshot-diff.js";
import {
  claimIsHeldByAnother,
  claimIsLive,
  claimLeaseExpiryMs,
} from "./shared/agent-claim.js";
import type { AgentModelIdentity } from "./shared/agent-model.js";
import type {
  AgentRequestDeletionResult,
  ProgressEvent,
  ReviewStore,
} from "./store.js";

const REQUEST_ID = /^[a-f0-9]{16}$/;
const SNAPSHOT_ID = /^[a-f0-9]{16,64}$/;

export class RetryableAgentClaimRejected extends AgentExchangeRejected {}

export class AgentClaimContended extends RetryableAgentClaimRejected {}

export class AgentClaimSelectionStale extends RetryableAgentClaimRejected {}

export class AgentClaimCanceled extends AgentClaimSelectionStale {}

export class AgentResponseConflict extends AgentExchangeRejected {
  readonly code = "stale-baseline";
  readonly baselineSnapshot: string;
  readonly committedSnapshot?: string;

  constructor({
    baselineSnapshot,
    committedSnapshot,
  }: {
    readonly baselineSnapshot: string;
    readonly committedSnapshot?: string;
  }) {
    super(
      "The plan changed underneath this request, so its baseline is stale. Reconcile the newer accepted plan before responding again.",
    );
    this.name = "AgentResponseConflict";
    this.baselineSnapshot = baselineSnapshot;
    this.committedSnapshot = committedSnapshot;
  }
}

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

const withTerminalCommitLock = async <TResult>({
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
    lockPath: join(lockedStore.reviewDirectory, ".agent-terminal.lock"),
    change: () => change(lockedStore),
    timeoutError: () =>
      new AgentExchangeRejected(
        "Another agent is committing a response. Try again.",
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
  return JSON.stringify(created);
};

type AgentAcceptedSnapshotFrontier = {
  readonly version: 1;
  readonly planId: string;
  readonly sequence: number;
  readonly requestId: string;
  readonly snapshot: string;
};

const readAcceptedSnapshotFrontier = async ({
  store,
  planId,
  baselineSnapshot,
}: {
  readonly store: ReviewStore;
  readonly planId: string;
  readonly baselineSnapshot: string;
}): Promise<AgentAcceptedSnapshotFrontier | undefined> => {
  const stored = await readAgentAcceptedSnapshotValue(store);
  if (!stored.exists) return undefined;
  const value = stored.value;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("version" in value) ||
    value.version !== 1 ||
    !("planId" in value) ||
    value.planId !== planId ||
    !("sequence" in value) ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    !("requestId" in value) ||
    typeof value.requestId !== "string" ||
    !REQUEST_ID.test(value.requestId) ||
    !("snapshot" in value) ||
    typeof value.snapshot !== "string" ||
    !SNAPSHOT_ID.test(value.snapshot)
  ) {
    throw new AgentResponseConflict({ baselineSnapshot });
  }
  return {
    version: 1,
    planId,
    sequence: value.sequence,
    requestId: value.requestId,
    snapshot: value.snapshot,
  };
};

type TextRange = {
  readonly start: number;
  readonly end: number;
};

const changedRanges = ({
  before,
  after,
}: {
  readonly before: string;
  readonly after: string;
}): {
  readonly deleted: ReadonlyArray<TextRange>;
  readonly inserted: ReadonlyArray<TextRange>;
} => {
  const deleted: Array<TextRange> = [];
  const inserted: Array<TextRange> = [];
  let beforeOffset = 0;
  let afterOffset = 0;
  for (const run of diffWords({ before, after })) {
    if (run.op === "same") {
      beforeOffset += run.text.length;
      afterOffset += run.text.length;
    } else if (run.op === "del") {
      deleted.push({
        start: beforeOffset,
        end: beforeOffset + run.text.length,
      });
      beforeOffset += run.text.length;
    } else {
      inserted.push({
        start: afterOffset,
        end: afterOffset + run.text.length,
      });
      afterOffset += run.text.length;
    }
  }
  return { deleted, inserted };
};

const survivingRanges = ({
  before,
  after,
}: {
  readonly before: string;
  readonly after: string;
}): ReadonlyArray<TextRange> => {
  const ranges: Array<TextRange> = [];
  let offset = 0;
  for (const run of diffWords({ before, after })) {
    if (run.op === "same") {
      ranges.push({ start: offset, end: offset + run.text.length });
      offset += run.text.length;
    } else if (run.op === "del") {
      offset += run.text.length;
    }
  }
  return ranges;
};

const rangeIsCovered = ({
  range,
  coverage,
}: {
  readonly range: TextRange;
  readonly coverage: ReadonlyArray<TextRange>;
}): boolean => {
  let coveredThrough = range.start;
  for (const candidate of coverage) {
    if (candidate.end <= coveredThrough) continue;
    if (candidate.start > coveredThrough) return false;
    coveredThrough = candidate.end;
    if (coveredThrough >= range.end) return true;
  }
  return coveredThrough >= range.end;
};

const rangesOverlap = (left: TextRange, right: TextRange): boolean =>
  left.start < right.end && right.start < left.end;

const candidateIncludesAcceptedChanges = ({
  baseline,
  accepted,
  candidate,
}: {
  readonly baseline: string;
  readonly accepted: string;
  readonly candidate: string;
}): boolean => {
  if (candidate === accepted || baseline === accepted) return true;
  const acceptedChanges = changedRanges({ before: baseline, after: accepted });
  const acceptedSurvivors = survivingRanges({
    before: accepted,
    after: candidate,
  });
  if (
    acceptedChanges.inserted.some(
      (range) => !rangeIsCovered({ range, coverage: acceptedSurvivors }),
    )
  ) {
    return false;
  }
  const baselineSurvivors = survivingRanges({
    before: baseline,
    after: candidate,
  });
  return !acceptedChanges.deleted.some((deleted) =>
    baselineSurvivors.some((surviving) => rangesOverlap(deleted, surviving)),
  );
};

const responseIncludesAcceptedSnapshot = async ({
  store,
  baselineSnapshot,
  acceptedSnapshot,
  candidateSnapshot,
}: {
  readonly store: ReviewStore;
  readonly baselineSnapshot: string;
  readonly acceptedSnapshot: string;
  readonly candidateSnapshot: string;
}): Promise<boolean> => {
  if (baselineSnapshot === acceptedSnapshot) return true;
  try {
    const [baseline, accepted, candidate] = await Promise.all([
      readSnapshot({ store, snapshot: baselineSnapshot }),
      readSnapshot({ store, snapshot: acceptedSnapshot }),
      readSnapshot({ store, snapshot: candidateSnapshot }),
    ]);
    return candidateIncludesAcceptedChanges({ baseline, accepted, candidate });
  } catch {
    return false;
  }
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

/** Takes or renews one agent session's exclusive claim on a request. */
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
  const takeover = await withRequestLock({
    store,
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
      const canceled = validateAgentRequest({ ...request, canceledAt: now });
      await writeAgentRequestValue({
        store: lockedStore,
        requestId,
        value: canceled,
      });
      return canceled;
    },
  });

/** Answers one request and marks it terminal as a single commit. */
export const commitRequestTerminal = async ({
  store,
  response,
  claimedBy,
  now,
  clock = Date.now,
  readCurrentSnapshot,
}: {
  readonly store: ReviewStore;
  readonly response: AgentResponse;
  readonly claimedBy: string;
  readonly now: string;
  readonly clock?: Clock;
  readonly readCurrentSnapshot?: () => Promise<string>;
}): Promise<AgentRequest> =>
  withTerminalCommitLock({
    store,
    change: (terminalStore) =>
      withRequestLock({
        store: terminalStore,
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
          const acceptedFrontier = await readAcceptedSnapshotFrontier({
            store: lockedStore,
            planId: request.planId,
            baselineSnapshot: request.baselineSnapshot,
          });
          const acceptedSnapshot =
            acceptedFrontier?.snapshot ?? request.baselineSnapshot;
          const currentSnapshot =
            readCurrentSnapshot === undefined
              ? response.resultSnapshot
              : await readCurrentSnapshot();
          const includesAcceptedSnapshot =
            await responseIncludesAcceptedSnapshot({
              store: lockedStore,
              baselineSnapshot: request.baselineSnapshot,
              acceptedSnapshot,
              candidateSnapshot: response.resultSnapshot,
            });
          if (
            !includesAcceptedSnapshot ||
            currentSnapshot !== response.resultSnapshot
          ) {
            throw new AgentResponseConflict({
              baselineSnapshot: request.baselineSnapshot,
              committedSnapshot: acceptedSnapshot,
            });
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
          await writeAgentAcceptedSnapshotValue({
            store: lockedStore,
            value: {
              version: 1,
              planId: request.planId,
              sequence: (acceptedFrontier?.sequence ?? 0) + 1,
              requestId: request.requestId,
              snapshot: response.resultSnapshot,
            } satisfies AgentAcceptedSnapshotFrontier,
          });
          await writeAgentRequestValue({
            store: lockedStore,
            requestId: response.requestId,
            value: answered,
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
