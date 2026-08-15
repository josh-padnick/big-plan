// Owns review session identity, liveness, replacement, and recovery facts.
// The server and CLI use this module instead of reading session files directly.

import {
  readSessionDescriptorValue,
  readSessionHeartbeatValue,
  withReviewStoreLock,
  writeSessionDescriptorValue,
  writeSessionHeartbeatValue,
} from "./store.js";
import type { ReviewStore } from "./store.js";

const HEARTBEAT_READ_ATTEMPTS = 5;
const HEARTBEAT_READ_RETRY_MS = 25;
export const REVIEW_HEARTBEAT_INTERVAL_MS = 750;
const SESSION_MAXIMUM_AGE_MS = 3_000;
const SESSION_ID = /^[a-f0-9]{16}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export type ReviewSessionDescriptor = {
  readonly version: 1;
  readonly sessionId: string;
  readonly planId: string;
  readonly plan: string;
  readonly url: string;
  readonly port: number;
  readonly pid: number;
  readonly startedAt: string;
  readonly token: string;
};

export type ReviewSessionView = {
  readonly sessionId: string;
  readonly planId: string;
  readonly plan: string;
  readonly authoritative: boolean;
  readonly latestReviewUrl?: string;
};

export type ReviewSessionLiveness = {
  readonly running: boolean;
  readonly stopReason?: string;
};

type ReviewSessionHeartbeat = {
  readonly sessionId: string;
  readonly running: boolean;
  readonly updatedAtMs: number;
  readonly stopReason?: string;
};

type Clock = () => number;

export type SessionAuthorityErrorCode =
  "invalid" | "missing" | "wrong-plan" | "stopped";

export class SessionAuthorityRejected extends Error {
  readonly code: SessionAuthorityErrorCode;

  constructor(code: SessionAuthorityErrorCode) {
    super(code);
    this.name = "SessionAuthorityRejected";
    this.code = code;
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const validateReviewSessionHeartbeat = (
  value: unknown,
): ReviewSessionHeartbeat | undefined => {
  if (
    !isRecord(value) ||
    typeof value.sessionId !== "string" ||
    !SESSION_ID.test(value.sessionId) ||
    typeof value.running !== "boolean" ||
    typeof value.updatedAtMs !== "number" ||
    !Number.isFinite(value.updatedAtMs) ||
    (value.stopReason !== undefined && typeof value.stopReason !== "string")
  ) {
    return undefined;
  }
  return {
    sessionId: value.sessionId,
    running: value.running,
    updatedAtMs: value.updatedAtMs,
    ...(value.stopReason === undefined ? {} : { stopReason: value.stopReason }),
  };
};

const heartbeatIsFresh = ({
  heartbeat,
  sessionId,
  observedAtMs,
  maximumAgeMs = SESSION_MAXIMUM_AGE_MS,
}: {
  readonly heartbeat: ReviewSessionHeartbeat | undefined;
  readonly sessionId: string;
  readonly observedAtMs: number;
  readonly maximumAgeMs?: number;
}): boolean =>
  heartbeat !== undefined &&
  heartbeat.sessionId === sessionId &&
  heartbeat.running &&
  Number.isFinite(observedAtMs) &&
  observedAtMs - heartbeat.updatedAtMs >= 0 &&
  observedAtMs - heartbeat.updatedAtMs <= maximumAgeMs;

/** Checks one session descriptor read from the owner-only review store. */
export const validateReviewSessionDescriptor = (
  value: unknown,
): ReviewSessionDescriptor | undefined => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.sessionId !== "string" ||
    !SESSION_ID.test(value.sessionId) ||
    typeof value.planId !== "string" ||
    !SESSION_ID.test(value.planId) ||
    typeof value.plan !== "string" ||
    value.plan === "" ||
    typeof value.url !== "string" ||
    !isHttpUrl(value.url) ||
    typeof value.port !== "number" ||
    !Number.isInteger(value.port) ||
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    typeof value.startedAt !== "string" ||
    Number.isNaN(Date.parse(value.startedAt)) ||
    typeof value.token !== "string" ||
    !TOKEN.test(value.token)
  ) {
    return undefined;
  }
  return {
    version: 1,
    sessionId: value.sessionId,
    planId: value.planId,
    plan: value.plan,
    url: value.url,
    port: value.port,
    pid: value.pid,
    startedAt: new Date(value.startedAt).toISOString(),
    token: value.token,
  };
};

/** Reads the one session that currently owns the plan mailbox. */
export const readCurrentReviewSession = async ({
  store,
}: {
  readonly store: ReviewStore;
}): Promise<ReviewSessionDescriptor | undefined> =>
  validateReviewSessionDescriptor(await readSessionDescriptorValue(store));

/** Replaces the current session with one complete checked descriptor. */
export const activateReviewSession = async ({
  store,
  descriptor,
}: {
  readonly store: ReviewStore;
  readonly descriptor: ReviewSessionDescriptor;
}): Promise<void> => {
  const checked = validateReviewSessionDescriptor(descriptor);
  if (checked === undefined) {
    throw new SessionAuthorityRejected("invalid");
  }
  await withReviewStoreLock({
    lockPath: store.sessionLockPath,
    change: async () => {
      await writeSessionDescriptorValue({ store, value: checked });
    },
    timeoutError: () => new Error("Another process is changing review custody"),
  });
};

/** Builds the browser-safe authority facts for one open review page. */
export const reviewSessionView = async ({
  store,
  sessionId,
  planId,
  plan,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly plan: string;
}): Promise<ReviewSessionView> => {
  const current = await readCurrentReviewSession({ store });
  const authoritative = current?.sessionId === sessionId;
  return {
    sessionId,
    planId,
    plan,
    authoritative,
    ...(authoritative || current === undefined
      ? {}
      : { latestReviewUrl: current.url }),
  };
};

/** Reports whether one server still owns writes to the shared plan mailbox. */
export const reviewSessionOwnsMailbox = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<boolean> =>
  (await readCurrentReviewSession({ store }))?.sessionId === sessionId;

export type ReviewSessionAuthorityResult<TResult> =
  | { readonly authoritative: false }
  | { readonly authoritative: true; readonly value: TResult };

/** Runs one mailbox mutation while the same session owns plan custody. */
export const withReviewSessionAuthority = async <TResult>({
  store,
  sessionId,
  change,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly change: () => Promise<TResult>;
}): Promise<ReviewSessionAuthorityResult<TResult>> =>
  withReviewStoreLock({
    lockPath: store.sessionLockPath,
    change: async () => {
      if (!(await reviewSessionOwnsMailbox({ store, sessionId }))) {
        return { authoritative: false };
      }
      return { authoritative: true, value: await change() };
    },
    timeoutError: () => new Error("Another process is changing review custody"),
  });

export const withRunningReviewSessionAuthority = async <TResult>({
  store,
  sessionId,
  change,
  clock = Date.now,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly change: () => Promise<TResult>;
  readonly clock?: Clock;
}): Promise<ReviewSessionAuthorityResult<TResult>> =>
  withReviewStoreLock({
    lockPath: store.sessionLockPath,
    change: async () => {
      const [session, heartbeat] = await Promise.all([
        readCurrentReviewSession({ store }),
        readSessionHeartbeatValue(store).then(validateReviewSessionHeartbeat),
      ]);
      if (
        session?.sessionId !== sessionId ||
        !heartbeatIsFresh({
          heartbeat,
          sessionId,
          observedAtMs: clock(),
        })
      ) {
        return { authoritative: false };
      }
      return { authoritative: true, value: await change() };
    },
    timeoutError: () => new Error("Another process is changing review custody"),
  });

export const stopReviewSessionIfInactive = async ({
  store,
  sessionId,
  stopReason,
  inactive,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly stopReason: string;
  readonly inactive: () => Promise<boolean>;
  readonly now?: number;
}): Promise<{ readonly authoritative: boolean; readonly stopped: boolean }> =>
  withReviewStoreLock({
    lockPath: store.sessionLockPath,
    change: () =>
      withReviewStoreLock({
        lockPath: store.heartbeatLockPath,
        change: async () => {
          const [session, heartbeat] = await Promise.all([
            readCurrentReviewSession({ store }),
            readSessionHeartbeatValue(store).then(
              validateReviewSessionHeartbeat,
            ),
          ]);
          if (
            session?.sessionId !== sessionId ||
            heartbeat?.sessionId !== sessionId ||
            !heartbeat.running
          ) {
            return { authoritative: false, stopped: false };
          }
          if (!(await inactive())) {
            return { authoritative: true, stopped: false };
          }
          await writeSessionHeartbeatValue({
            store,
            value: {
              sessionId,
              running: false,
              updatedAtMs: now,
              stopReason,
            },
          });
          return { authoritative: true, stopped: true };
        },
        timeoutError: () =>
          new Error("Another process is writing this heartbeat"),
      }),
    timeoutError: () => new Error("Another process is changing review custody"),
  });

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

/** Returns matching server liveness and any explicit recorded stop reason. */
export const reviewSessionIsRunning = async ({
  store,
  sessionId,
  now,
  maximumAgeMs = SESSION_MAXIMUM_AGE_MS,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly now?: number;
  readonly maximumAgeMs?: number;
}): Promise<ReviewSessionLiveness> => {
  let value: unknown;
  for (let attempt = 0; attempt < HEARTBEAT_READ_ATTEMPTS; attempt += 1) {
    value = await readSessionHeartbeatValue(store);
    if (value !== undefined || attempt === HEARTBEAT_READ_ATTEMPTS - 1) break;
    await wait(HEARTBEAT_READ_RETRY_MS);
  }
  const heartbeat = validateReviewSessionHeartbeat(value);
  if (heartbeat === undefined) return { running: false };
  const observedAtMs = now ?? Date.now();
  if (!heartbeatIsFresh({ heartbeat, sessionId, observedAtMs, maximumAgeMs })) {
    return {
      running: false,
      ...(heartbeat.sessionId === sessionId &&
      !heartbeat.running &&
      heartbeat.stopReason !== undefined
        ? { stopReason: heartbeat.stopReason }
        : {}),
    };
  }
  return { running: true };
};

/**
 * Writes a heartbeat only while the same session still owns the mailbox.
 *
 * This takes the heartbeat's own lock rather than the custody lock every
 * mutation holds. Sharing that lock made liveness a hostage of the write path:
 * one mutation that never settled (BIG-44) held custody for the life of the
 * process, so the heartbeat could not renew and the agent concluded the
 * session had stopped, while the browser was still being served. Custody is
 * still checked here; it is only the waiting that is no longer shared.
 */
export const refreshReviewSessionHeartbeat = async ({
  store,
  sessionId,
  running,
  stopReason,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly running: boolean;
  readonly stopReason?: string;
  readonly now?: number;
}): Promise<boolean> =>
  withReviewStoreLock({
    lockPath: store.heartbeatLockPath,
    change: async () => {
      if (!(await reviewSessionOwnsMailbox({ store, sessionId }))) return false;
      const current = validateReviewSessionHeartbeat(
        await readSessionHeartbeatValue(store),
      );
      if (running && current?.sessionId === sessionId && !current.running) {
        return false;
      }
      await writeSessionHeartbeatValue({
        store,
        value: {
          sessionId,
          running,
          updatedAtMs: now,
          ...(stopReason === undefined ? {} : { stopReason }),
        },
      });
      return true;
    },
    timeoutError: () => new Error("Another process is writing this heartbeat"),
  });

/** Returns the current live session for one exact plan or a stable reason. */
export const liveReviewSessionForPlan = async ({
  store,
  planId,
  plan,
}: {
  readonly store: ReviewStore;
  readonly planId: string;
  readonly plan: string;
}): Promise<ReviewSessionDescriptor> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const value = await readSessionDescriptorValue(store);
    if (value === undefined) throw new SessionAuthorityRejected("missing");
    const current = validateReviewSessionDescriptor(value);
    if (current === undefined) throw new SessionAuthorityRejected("invalid");
    if (current.planId !== planId || current.plan !== plan) {
      throw new SessionAuthorityRejected("wrong-plan");
    }
    if (
      (await reviewSessionIsRunning({ store, sessionId: current.sessionId }))
        .running
    ) {
      return current;
    }
    if (attempt === 0) await wait(REVIEW_HEARTBEAT_INTERVAL_MS);
  }
  throw new SessionAuthorityRejected("stopped");
};
