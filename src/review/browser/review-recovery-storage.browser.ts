// Owns browser persistence policy for live review recovery so storage keys and
// validation cannot drift across the review controller's orchestration paths.
//
// Recovery is a cache of this tab's own unsynchronized work, never a second
// authority. One record per tab, written and cleared only by the tab that owns
// it, read once at hydration. Records are never scanned, merged, or adopted
// across tabs: the runtime is the only place two tabs reconcile, and making
// them converge with each other while both are offline needs causal versions
// and cross-tab serialization that belong to issue #99, not here.

import type { CommentTarget, ReviewComment } from "../shared/comment.js";
import { isStoredCommentTarget } from "../shared/comment.js";
import {
  isReviewCommentValue as isComment,
  isReviewWireRecord as isRecord,
} from "../shared/review-wire.js";
import type {
  LiveReviewRecovery,
  ReviewRecoveryConflict,
  ReviewRecoveryState,
} from "./review-recovery-merge.js";

const LIVE_RECOVERY_SNAPSHOT_VERSION = 11;

export type LiveRecoveryScope = {
  readonly planId: string;
  readonly sessionId: string;
};

/** Comment text a reviewer typed that no comment holds yet. */
export type RecoveredComposer = {
  /** The comment being written, with the target it was opened against. */
  readonly comment: {
    readonly target: CommentTarget;
    readonly premiseSnapshot: string;
    readonly body: string;
  } | null;
  /** Reply text per comment thread, which has no runtime home and needs none. */
  readonly replies: ReadonlyMap<string, string>;
};

export const EMPTY_RECOVERED_COMPOSER: RecoveredComposer = {
  comment: null,
  replies: new Map(),
};

const sameRecoveredComment = (
  left: RecoveredComposer["comment"],
  right: RecoveredComposer["comment"],
): boolean => JSON.stringify(left) === JSON.stringify(right);

/** Keeps browser-only input created after hydration began ahead of recovery. */
export const mergeRecoveredComposerAfterHydration = ({
  before,
  current,
  recovered,
}: {
  readonly before: RecoveredComposer;
  readonly current: RecoveredComposer;
  readonly recovered: RecoveredComposer;
}): RecoveredComposer => {
  const replies = new Map<string, string>();
  for (const commentId of new Set([
    ...before.replies.keys(),
    ...current.replies.keys(),
    ...recovered.replies.keys(),
  ])) {
    const beforeBody = before.replies.get(commentId);
    const currentBody = current.replies.get(commentId);
    const body =
      currentBody === beforeBody
        ? recovered.replies.get(commentId)
        : currentBody;
    if (body !== undefined) replies.set(commentId, body);
  }
  return {
    comment: sameRecoveredComment(current.comment, before.comment)
      ? recovered.comment
      : current.comment,
    replies,
  };
};

export type StoredLiveReviewRecovery = LiveReviewRecovery & {
  readonly composer: RecoveredComposer;
};

/**
 * This tab's writer identity. It exists only to key this tab's own record so
 * two tabs of one review session cannot overwrite each other's typing; nothing
 * infers from it whether another tab is alive.
 */
export type LiveRecoveryOwner = {
  readonly ownerId: string;
  readonly recoveryAvailable: boolean;
};

const liveRecoveryStoragePrefix = (scope: LiveRecoveryScope): string =>
  `big-plan:review:live-recovery:${scope.planId}:${scope.sessionId}`;

const liveRecoveryStorageKey = ({
  scope,
  ownerId,
}: {
  readonly scope: LiveRecoveryScope;
  readonly ownerId: string;
}): string => `${liveRecoveryStoragePrefix(scope)}:tab:${ownerId}`;

const liveRecoveryOwnerSessionKey = (scope: LiveRecoveryScope): string =>
  `${liveRecoveryStoragePrefix(scope)}:owner`;

/**
 * Canonicalizes the reviewer state used by sync and recovery cleanup
 * decisions. Only the content the runtime owns takes part: stored target
 * metadata is canonicalized on first save while the browser keeps its own
 * display copy, so a fingerprint over whole comments would report an
 * already-accepted state as forever unsynchronized.
 */
export const persistedReviewFingerprint = ({
  drafts,
  resolvedCommentIds,
}: {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly resolvedCommentIds: ReadonlySet<string>;
}): string =>
  JSON.stringify({
    drafts: drafts.map(({ id, body }) => ({ id, body })),
    resolvedCommentIds: Array.from(resolvedCommentIds).sort(),
  });

const isStringRecord = (
  value: unknown,
): value is Readonly<Record<string, string>> =>
  isRecord(value) &&
  Object.values(value).every((entry) => typeof entry === "string");

/** Decodes runtime-owned reviewer state without accepting partial data. */
const readStoredReviewState = (value: unknown): ReviewRecoveryState | null => {
  if (
    !isRecord(value) ||
    !Array.isArray(value.drafts) ||
    !value.drafts.every(isComment) ||
    !Array.isArray(value.resolvedCommentIds) ||
    !value.resolvedCommentIds.every(
      (entry): entry is string => typeof entry === "string",
    )
  ) {
    return null;
  }
  return {
    drafts: value.drafts,
    resolvedCommentIds: new Set(value.resolvedCommentIds),
  };
};

/** Validates every persisted conflict variant before it reaches the prompt. */
const isStoredReviewRecoveryConflict = (
  value: unknown,
): value is ReviewRecoveryConflict => {
  if (!isRecord(value) || typeof value.commentId !== "string") {
    return false;
  }
  if (value.kind === "resolution") {
    return (
      typeof value.localResolved === "boolean" &&
      typeof value.runtimeResolved === "boolean"
    );
  }
  return (
    (value.kind === "draft" &&
      (typeof value.localBody === "string" || value.localBody === null) &&
      (typeof value.runtimeBody === "string" || value.runtimeBody === null)) ||
    (value.kind === "sent" &&
      typeof value.localBody === "string" &&
      typeof value.runtimeBody === "string")
  );
};

/** Decodes browser-only input while rejecting targets that cannot be trusted. */
const readRecoveredComposer = (value: unknown): RecoveredComposer => {
  if (!isRecord(value)) return EMPTY_RECOVERED_COMPOSER;
  const comment = value.comment;
  return {
    comment:
      isRecord(comment) &&
      typeof comment.body === "string" &&
      typeof comment.premiseSnapshot === "string" &&
      isStoredCommentTarget(comment.target)
        ? {
            target: comment.target,
            premiseSnapshot: comment.premiseSnapshot,
            body: comment.body,
          }
        : null,
    replies: isStringRecord(value.replies)
      ? new Map(Object.entries(value.replies))
      : new Map(),
  };
};

const readRecoveryRecord = (key: string): StoredLiveReviewRecovery | null => {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    const reviewState = readStoredReviewState(parsed);
    if (
      !isRecord(parsed) ||
      parsed.version !== LIVE_RECOVERY_SNAPSHOT_VERSION ||
      reviewState === null ||
      !isRecord(parsed.reconciliation) ||
      !isRecord(parsed.reconciliation.base) ||
      !isStringRecord(parsed.reconciliation.base.draftBodies) ||
      !Array.isArray(parsed.reconciliation.base.resolvedCommentIds) ||
      !parsed.reconciliation.base.resolvedCommentIds.every(
        (value): value is string => typeof value === "string",
      ) ||
      !Array.isArray(parsed.reconciliation.conflicts) ||
      !parsed.reconciliation.conflicts.every(isStoredReviewRecoveryConflict)
    ) {
      return null;
    }
    const runtime =
      parsed.reconciliation.runtime === null
        ? null
        : readStoredReviewState(parsed.reconciliation.runtime);
    if (parsed.reconciliation.runtime !== null && runtime === null) {
      return null;
    }
    if (parsed.reconciliation.conflicts.length > 0 && runtime === null) {
      return null;
    }
    return {
      ...reviewState,
      composer: readRecoveredComposer(parsed.composer),
      reconciliation: {
        base: {
          draftBodies: new Map(
            Object.entries(parsed.reconciliation.base.draftBodies),
          ),
          resolvedCommentIds: new Set(
            parsed.reconciliation.base.resolvedCommentIds,
          ),
        },
        conflicts: parsed.reconciliation.conflicts,
        runtime,
      },
    };
  } catch {
    return null;
  }
};

/** Serializes the complete recovery record written by exactly one tab. */
const serializedLiveReviewRecovery = (
  recovery: StoredLiveReviewRecovery,
): string =>
  JSON.stringify({
    version: LIVE_RECOVERY_SNAPSHOT_VERSION,
    drafts: recovery.drafts,
    resolvedCommentIds: Array.from(recovery.resolvedCommentIds),
    reconciliation: {
      base: {
        draftBodies: Object.fromEntries(
          recovery.reconciliation.base.draftBodies,
        ),
        resolvedCommentIds: Array.from(
          recovery.reconciliation.base.resolvedCommentIds,
        ),
      },
      conflicts: recovery.reconciliation.conflicts,
      runtime:
        recovery.reconciliation.runtime === null
          ? null
          : {
              drafts: recovery.reconciliation.runtime.drafts,
              resolvedCommentIds: Array.from(
                recovery.reconciliation.runtime.resolvedCommentIds,
              ),
            },
    },
    composer: {
      comment: recovery.composer.comment,
      replies: Object.fromEntries(recovery.composer.replies),
    },
  });

/** Mints a writer identity used only by this tab's recovery record. */
const randomRecoveryOwnerId = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
};

/**
 * Takes this tab's writer identity, reusing it across a reload so a refresh
 * recovers what the same tab was holding. Nothing here inspects, claims, or
 * infers anything about another tab.
 */
export const claimLiveRecoveryOwner = (
  scope: LiveRecoveryScope,
): LiveRecoveryOwner => {
  try {
    const sessionKey = liveRecoveryOwnerSessionKey(scope);
    const previousOwnerId = sessionStorage.getItem(sessionKey);
    const navigation = performance.getEntriesByType("navigation")[0];
    const isReload =
      navigation instanceof PerformanceNavigationTiming &&
      navigation.type === "reload";
    const ownerId =
      isReload && previousOwnerId !== null
        ? previousOwnerId
        : randomRecoveryOwnerId();
    sessionStorage.setItem(sessionKey, ownerId);
    return { ownerId, recoveryAvailable: true };
  } catch {
    return { ownerId: randomRecoveryOwnerId(), recoveryAvailable: false };
  }
};

/** Reads the one record this tab owns, and never any other tab's. */
export const readLiveReviewRecovery = ({
  scope,
  owner,
}: {
  readonly scope: LiveRecoveryScope;
  readonly owner: LiveRecoveryOwner;
}): StoredLiveReviewRecovery | null =>
  owner.recoveryAvailable
    ? readRecoveryRecord(
        liveRecoveryStorageKey({ scope, ownerId: owner.ownerId }),
      )
    : null;

/** Writes only the record this browser tab owns. */
export const writeLiveReviewRecovery = ({
  scope,
  ownerId,
  recovery,
}: {
  readonly scope: LiveRecoveryScope;
  readonly ownerId: string;
  readonly recovery: StoredLiveReviewRecovery;
}): boolean => {
  try {
    localStorage.setItem(
      liveRecoveryStorageKey({ scope, ownerId }),
      serializedLiveReviewRecovery(recovery),
    );
    return true;
  } catch {
    return false;
  }
};

/** Clears only the snapshot confirmed by the completed runtime write. */
export const clearLiveReviewRecovery = ({
  scope,
  ownerId,
  fingerprint,
}: {
  readonly scope: LiveRecoveryScope;
  readonly ownerId: string;
  readonly fingerprint: string;
}): boolean => {
  const key = liveRecoveryStorageKey({ scope, ownerId });
  const recovery = readRecoveryRecord(key);
  if (
    recovery === null ||
    recovery.reconciliation.conflicts.length > 0 ||
    recovery.composer.comment !== null ||
    recovery.composer.replies.size > 0 ||
    persistedReviewFingerprint(recovery) !== fingerprint
  ) {
    return false;
  }
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};
