// Owns browser persistence policy for live review recovery so storage keys,
// validation, tab ownership, orphan-candidate expiry, and adoption history
// cannot drift across the review controller's orchestration paths. Returning
// owners keep their work indefinitely; only records without their owner expire.

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

const LIVE_RECOVERY_SNAPSHOT_VERSION = 10;
const LIVE_RECOVERY_ADOPTIONS_VERSION = 1;
export const LIVE_RECOVERY_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

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

export type PendingLiveRecoveryAdoption = {
  readonly ownerId: string;
  readonly updatedAtMs: number;
};

export type StoredLiveReviewRecovery = LiveReviewRecovery & {
  readonly ownerId: string;
  readonly updatedAtMs: number;
  readonly composer: RecoveredComposer;
  readonly pendingAdoption: PendingLiveRecoveryAdoption | null;
};

type StoredLiveRecoveryAdoptions = {
  readonly ownerId: string;
  readonly updatedAtMs: number;
  readonly recoveryUpdatedAtMsByOwnerId: ReadonlyMap<string, number>;
};

export type LiveRecoveryOwner = {
  readonly ownerId: string;
  readonly recoveryAvailable: boolean;
};

export type LiveRecoverySelection = {
  readonly recovery: StoredLiveReviewRecovery | null;
  readonly source: "owned" | "orphan" | null;
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

const liveRecoveryAdoptionsStorageKey = ({
  scope,
  ownerId,
}: {
  readonly scope: LiveRecoveryScope;
  readonly ownerId: string;
}): string => `${liveRecoveryStoragePrefix(scope)}:adoptions:${ownerId}`;

const liveRecoveryOwnerSessionKey = (scope: LiveRecoveryScope): string =>
  `${liveRecoveryStoragePrefix(scope)}:owner`;

/** Canonicalizes the reviewer state used by recovery cleanup decisions. */
export const persistedReviewFingerprint = ({
  drafts,
  resolvedCommentIds,
}: {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly resolvedCommentIds: ReadonlySet<string>;
}): string =>
  JSON.stringify({
    drafts,
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

const readPendingAdoption = (
  value: unknown,
): PendingLiveRecoveryAdoption | null =>
  isRecord(value) &&
  typeof value.ownerId === "string" &&
  typeof value.updatedAtMs === "number"
    ? { ownerId: value.ownerId, updatedAtMs: value.updatedAtMs }
    : null;

/** Reads one tab-owned recovery snapshot without accepting partial data. */
export const readLiveReviewRecovery = (
  key: string,
): StoredLiveReviewRecovery | null => {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    const reviewState = readStoredReviewState(parsed);
    const pendingAdoption = isRecord(parsed)
      ? readPendingAdoption(parsed.pendingAdoption)
      : null;
    if (
      !isRecord(parsed) ||
      parsed.version !== LIVE_RECOVERY_SNAPSHOT_VERSION ||
      typeof parsed.ownerId !== "string" ||
      typeof parsed.updatedAtMs !== "number" ||
      reviewState === null ||
      !isRecord(parsed.reconciliation) ||
      !isRecord(parsed.reconciliation.base) ||
      !isStringRecord(parsed.reconciliation.base.draftBodies) ||
      !Array.isArray(parsed.reconciliation.base.resolvedCommentIds) ||
      !parsed.reconciliation.base.resolvedCommentIds.every(
        (value): value is string => typeof value === "string",
      ) ||
      !Array.isArray(parsed.reconciliation.conflicts) ||
      !parsed.reconciliation.conflicts.every(isStoredReviewRecoveryConflict) ||
      (parsed.pendingAdoption !== null && pendingAdoption === null)
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
      ownerId: parsed.ownerId,
      updatedAtMs: parsed.updatedAtMs,
      composer: readRecoveredComposer(parsed.composer),
      pendingAdoption,
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
    ownerId: recovery.ownerId,
    updatedAtMs: recovery.updatedAtMs,
    pendingAdoption: recovery.pendingAdoption,
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

/** Reads one tab-owned adoption ledger without accepting partial data. */
const readLiveRecoveryAdoptions = (
  key: string,
): StoredLiveRecoveryAdoptions | null => {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    const revisionEntries =
      isRecord(parsed) && isRecord(parsed.recoveryUpdatedAtMsByOwnerId)
        ? Object.entries(parsed.recoveryUpdatedAtMsByOwnerId)
        : [];
    if (
      !isRecord(parsed) ||
      parsed.version !== LIVE_RECOVERY_ADOPTIONS_VERSION ||
      typeof parsed.ownerId !== "string" ||
      typeof parsed.updatedAtMs !== "number" ||
      !isRecord(parsed.recoveryUpdatedAtMsByOwnerId) ||
      !revisionEntries.every(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      )
    ) {
      return null;
    }
    return {
      ownerId: parsed.ownerId,
      updatedAtMs: parsed.updatedAtMs,
      recoveryUpdatedAtMsByOwnerId: new Map(revisionEntries),
    };
  } catch {
    return null;
  }
};

/** Collects adopted orphan revisions while expiring only stale ledgers. */
const adoptedLiveRecoveryRevisions = ({
  scope,
  nowMs,
}: {
  readonly scope: LiveRecoveryScope;
  readonly nowMs: number;
}): ReadonlyMap<string, number> => {
  const prefix = `${liveRecoveryStoragePrefix(scope)}:adoptions:`;
  const revisions = new Map<string, number>();
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === null || !key.startsWith(prefix)) continue;
    const adoptions = readLiveRecoveryAdoptions(key);
    if (
      adoptions === null ||
      nowMs - adoptions.updatedAtMs > LIVE_RECOVERY_EXPIRY_MS
    ) {
      localStorage.removeItem(key);
      index -= 1;
      continue;
    }
    for (const [
      ownerId,
      updatedAtMs,
    ] of adoptions.recoveryUpdatedAtMsByOwnerId) {
      revisions.set(
        ownerId,
        Math.max(revisions.get(ownerId) ?? 0, updatedAtMs),
      );
    }
  }
  return revisions;
};

/** Records one adopted orphan revision in this tab's independent ledger. */
export const recordLiveRecoveryAdoption = ({
  scope,
  ownerId,
  recoveryOwnerId,
  recoveryUpdatedAtMs,
  nowMs,
}: {
  readonly scope: LiveRecoveryScope;
  readonly ownerId: string;
  readonly recoveryOwnerId: string;
  readonly recoveryUpdatedAtMs: number;
  readonly nowMs: number;
}): boolean => {
  const key = liveRecoveryAdoptionsStorageKey({ scope, ownerId });
  const previous = readLiveRecoveryAdoptions(key);
  const revisions = new Map(previous?.recoveryUpdatedAtMsByOwnerId ?? []);
  revisions.set(
    recoveryOwnerId,
    Math.max(revisions.get(recoveryOwnerId) ?? 0, recoveryUpdatedAtMs),
  );
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: LIVE_RECOVERY_ADOPTIONS_VERSION,
        ownerId,
        updatedAtMs: nowMs,
        recoveryUpdatedAtMsByOwnerId: Object.fromEntries(revisions),
      }),
    );
    return true;
  } catch {
    return false;
  }
};

/** Mints a writer identity used only by this tab's recovery record. */
const randomRecoveryOwnerId = (): string => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
};

/** Claims a tab writer identity without inferring whether another tab is live. */
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

/** Selects continuity first, then the newest unexpired recovery candidate. */
export const selectLiveReviewRecovery = ({
  scope,
  owner,
  nowMs,
}: {
  readonly scope: LiveRecoveryScope;
  readonly owner: LiveRecoveryOwner;
  readonly nowMs: number;
}): LiveRecoverySelection => {
  if (!owner.recoveryAvailable) {
    return { recovery: null, source: null, recoveryAvailable: false };
  }
  try {
    const owned = readLiveReviewRecovery(
      liveRecoveryStorageKey({ scope, ownerId: owner.ownerId }),
    );
    const adoptedRevisions = adoptedLiveRecoveryRevisions({ scope, nowMs });
    const prefix = `${liveRecoveryStoragePrefix(scope)}:tab:`;
    const candidates: Array<StoredLiveReviewRecovery> = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key === null || !key.startsWith(prefix)) continue;
      const recovery = readLiveReviewRecovery(key);
      if (recovery === null || recovery.ownerId === owner.ownerId) continue;
      if (nowMs - recovery.updatedAtMs > LIVE_RECOVERY_EXPIRY_MS) {
        localStorage.removeItem(key);
        index -= 1;
        continue;
      }
      if (
        (adoptedRevisions.get(recovery.ownerId) ?? 0) >= recovery.updatedAtMs
      ) {
        continue;
      }
      candidates.push(recovery);
    }
    // A returning owner never loses its own unsynchronized work to a timer.
    // Expiry applies only when a record is being considered as an orphan.
    if (owned !== null) {
      return { recovery: owned, source: "owned", recoveryAvailable: true };
    }
    const orphan = candidates.sort(
      (left, right) => right.updatedAtMs - left.updatedAtMs,
    )[0];
    return orphan === undefined
      ? { recovery: null, source: null, recoveryAvailable: true }
      : { recovery: orphan, source: "orphan", recoveryAvailable: true };
  } catch {
    return { recovery: null, source: null, recoveryAvailable: false };
  }
};

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
  const recovery = readLiveReviewRecovery(key);
  if (
    recovery === null ||
    recovery.reconciliation.conflicts.length > 0 ||
    recovery.pendingAdoption !== null ||
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
