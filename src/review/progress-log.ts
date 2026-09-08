// Owns progress event validation, incremental log reads, sequence allocation,
// and compaction. Callers keep mutation under the mailbox lock.

import { appendFile, chmod, open, readFile, stat } from "node:fs/promises";
import { FILE_MODE, writeFileAtomically } from "./store-files.js";
import type { ReviewStore } from "./store.js";
import {
  PROGRESS_TEXT_LIMIT,
  isProgressState,
  isProgressStepCode,
  type ProgressState,
  type ProgressStepCode,
} from "./shared/progress-code.js";

// A status file is writable by any local process, so a relayed event carries
// only these states and a bounded amount of text.

export const PROGRESS_EVENT_LIMIT = 200;

/** One relayed agent progress event, after checking. */
export type ProgressEvent = {
  readonly sessionId: string;
  readonly requestId?: string;
  readonly atMs?: number;
  readonly seq: number;
  readonly stepCode: ProgressStepCode;
  readonly step: string;
  readonly state: ProgressState;
  readonly detail?: string;
};

const asProgressEvent = ({
  value,
  sessionId,
}: {
  readonly value: unknown;
  readonly sessionId: string;
}): ProgressEvent | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const event = value as Readonly<Record<string, unknown>>;
  if (event.sessionId !== sessionId) {
    return undefined;
  }
  if (typeof event.seq !== "number" || !Number.isInteger(event.seq)) {
    return undefined;
  }
  if (
    !isProgressStepCode(event.stepCode) ||
    typeof event.step !== "string" ||
    !isProgressState(event.state)
  ) {
    return undefined;
  }
  return {
    sessionId,
    ...(typeof event.requestId === "string" &&
    /^[a-f0-9]{16}$/.test(event.requestId)
      ? { requestId: event.requestId }
      : {}),
    ...(typeof event.atMs === "number" && Number.isFinite(event.atMs)
      ? { atMs: event.atMs }
      : {}),
    seq: event.seq,
    stepCode: event.stepCode,
    step: event.step.slice(0, PROGRESS_TEXT_LIMIT),
    state: event.state,
    ...(typeof event.detail === "string"
      ? { detail: event.detail.slice(0, PROGRESS_TEXT_LIMIT) }
      : {}),
  };
};

// The parsed progress log, per file, for this process. The browser polls the
// progress route about forty times a minute and every appended event used to
// reparse the whole history under a lock, so the cost of one event grew with
// the length of the session it belonged to.
//
// The log is append-only apart from compaction, which only ever shrinks it, so
// a file that is longer than what this process parsed has been appended to and
// only those bytes need parsing. Any other change - a shorter file, a
// different modification time at the same length - drops the cache and starts
// over, because the one thing this must never do is answer from a history that
// is no longer on disk.
type ProgressLogCache = {
  readonly version: ProgressFileVersion;
  /** Bytes ending at the last complete line, which is all that was parsed. */
  readonly parsedBytes: number;
  readonly values: ReadonlyArray<unknown>;
};

type ProgressFileVersion = {
  readonly device: number;
  readonly inode: number;
  readonly sizeBytes: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
};

const progressLogCaches = new Map<string, ProgressLogCache>();
const progressCompactionChecks = new Map<string, number>();

const progressFileVersion = ({
  dev,
  ino,
  size,
  mtimeMs,
  ctimeMs,
}: {
  readonly dev: number;
  readonly ino: number;
  readonly size: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}): ProgressFileVersion => ({
  device: dev,
  inode: ino,
  sizeBytes: size,
  mtimeMs,
  ctimeMs,
});

const sameProgressFile = (
  left: ProgressFileVersion,
  right: ProgressFileVersion,
): boolean => left.device === right.device && left.inode === right.inode;

const sameProgressVersion = (
  left: ProgressFileVersion,
  right: ProgressFileVersion,
): boolean =>
  sameProgressFile(left, right) &&
  left.sizeBytes === right.sizeBytes &&
  left.mtimeMs === right.mtimeMs &&
  left.ctimeMs === right.ctimeMs;

const parseProgressLines = (raw: string): ReadonlyArray<unknown> => {
  const values: Array<unknown> = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      values.push(JSON.parse(line));
    } catch {
      // A line this process cannot parse is state some other writer left
      // behind, and it is skipped on every read rather than repaired.
    }
  }
  return values;
};

/** Reads a stable prefix of the file currently published at `path`. */
const readProgressBytes = async ({
  path,
  from,
  expected,
}: {
  readonly path: string;
  readonly from: number;
  readonly expected?: ProgressFileVersion;
}): Promise<
  { readonly bytes: Buffer; readonly version: ProgressFileVersion } | undefined
> => {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return undefined;
  }
  try {
    let before: ProgressFileVersion;
    try {
      before = progressFileVersion(await handle.stat());
    } catch {
      return undefined;
    }
    if (
      (expected !== undefined && !sameProgressVersion(before, expected)) ||
      from > before.sizeBytes
    ) {
      return undefined;
    }
    const buffer = Buffer.alloc(before.sizeBytes - from);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        from + offset,
      );
      if (bytesRead === 0) return undefined;
      offset += bytesRead;
    }
    let after: ProgressFileVersion;
    let published: ProgressFileVersion;
    try {
      after = progressFileVersion(await handle.stat());
      published = progressFileVersion(await stat(path));
    } catch {
      return undefined;
    }
    if (
      !sameProgressFile(before, after) ||
      !sameProgressFile(before, published) ||
      after.sizeBytes < before.sizeBytes ||
      published.sizeBytes < before.sizeBytes ||
      (after.sizeBytes === before.sizeBytes &&
        !sameProgressVersion(before, after)) ||
      (published.sizeBytes === before.sizeBytes &&
        !sameProgressVersion(before, published))
    ) {
      return undefined;
    }
    return { bytes: buffer, version: before };
  } finally {
    await handle.close();
  }
};

const readWholeProgressBytes = async (
  path: string,
): Promise<
  { readonly bytes: Buffer; readonly version: ProgressFileVersion } | undefined
> => {
  try {
    const before = progressFileVersion(await stat(path));
    const bytes = await readFile(path);
    const after = progressFileVersion(await stat(path));
    return bytes.length === before.sizeBytes &&
      sameProgressVersion(before, after)
      ? { bytes, version: before }
      : undefined;
  } catch {
    return undefined;
  }
};

/** Returns every parsed line of one progress log, reusing what it can. */
const readProgressValues = async (
  path: string,
): Promise<ReadonlyArray<unknown>> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let version: ProgressFileVersion;
    try {
      version = progressFileVersion(await stat(path));
    } catch {
      progressLogCaches.delete(path);
      progressCompactionChecks.delete(path);
      return [];
    }
    const cached = progressLogCaches.get(path);
    if (cached !== undefined && sameProgressVersion(cached.version, version)) {
      return cached.values;
    }
    if (
      cached !== undefined &&
      sameProgressFile(cached.version, version) &&
      version.sizeBytes > cached.version.sizeBytes
    ) {
      const appended = await readProgressBytes({
        path,
        from: cached.parsedBytes,
        expected: version,
      });
      if (appended !== undefined) {
        const lastBreak = appended.bytes.lastIndexOf(0x0a);
        const complete =
          lastBreak === -1
            ? Buffer.alloc(0)
            : appended.bytes.subarray(0, lastBreak + 1);
        const values = [
          ...cached.values,
          ...parseProgressLines(complete.toString("utf8")),
        ];
        progressLogCaches.set(path, {
          version: appended.version,
          parsedBytes: cached.parsedBytes + complete.length,
          values,
        });
        return values;
      }
    }
    const whole = await readWholeProgressBytes(path);
    if (whole === undefined) continue;
    const lastBreak = whole.bytes.lastIndexOf(0x0a);
    const complete =
      lastBreak === -1
        ? Buffer.alloc(0)
        : whole.bytes.subarray(0, lastBreak + 1);
    const values = parseProgressLines(complete.toString("utf8"));
    if (cached !== undefined) progressCompactionChecks.delete(path);
    progressLogCaches.set(path, {
      version: whole.version,
      parsedBytes: complete.length,
      values,
    });
    return values;
  }
  throw new Error(`Progress log changed repeatedly while reading ${path}`);
};

type ReadableProgressEntry = {
  readonly event: ProgressEvent;
  readonly index: number;
};

type ReadableProgressHistory = {
  readonly entries: Array<ReadableProgressEntry>;
  highestSequence: number;
};

const readableProgressHistories = (
  values: ReadonlyArray<unknown>,
): ReadonlyMap<string, ReadableProgressHistory> => {
  const histories = new Map<string, ReadableProgressHistory>();
  for (const [index, value] of values.entries()) {
    const sessionId =
      typeof value === "object" &&
      value !== null &&
      "sessionId" in value &&
      typeof value.sessionId === "string"
        ? value.sessionId
        : undefined;
    if (sessionId === undefined) continue;
    const event = asProgressEvent({ value, sessionId });
    const history = histories.get(sessionId) ?? {
      entries: [],
      highestSequence: 0,
    };
    if (event === undefined || event.seq <= history.highestSequence) continue;
    history.highestSequence = event.seq;
    history.entries.push({ event, index });
    histories.set(sessionId, history);
  }
  return histories;
};

/**
 * Relays the agent's status channel: line-delimited events, kept only when
 * they belong to the running session and advance its sequence. A foreign or
 * out-of-order event is dropped rather than shown to the reviewer as live.
 */
const readProgressHistory = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<{
  readonly events: ReadonlyArray<ProgressEvent>;
  readonly highestSequence: number;
}> => {
  const history = readableProgressHistories(
    await readProgressValues(store.progressPath),
  ).get(sessionId);
  return history === undefined
    ? { events: [], highestSequence: 0 }
    : {
        events: history.entries.map((entry) => entry.event),
        highestSequence: history.highestSequence,
      };
};

export const readProgress = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<ReadonlyArray<ProgressEvent>> => {
  const history = await readProgressHistory({ store, sessionId });
  return history.events.slice(-PROGRESS_EVENT_LIMIT);
};

/**
 * The sequence one session's next event takes. Callers hold the progress lock
 * across this and the append that follows it, so the number they receive is
 * still theirs when they use it.
 */
export const nextProgressSequence = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<number> =>
  (await readProgressHistory({ store, sessionId })).highestSequence + 1;

/** Appends one checked event for the mailbox mutation owner. */
export const appendProgressValue = async ({
  store,
  event,
}: {
  readonly store: ReviewStore;
  readonly event: ProgressEvent;
}): Promise<void> => {
  await appendFile(store.progressPath, `${JSON.stringify(event)}\n`, {
    mode: FILE_MODE,
  });
  await chmod(store.progressPath, FILE_MODE);
};

const PROGRESS_COMPACTION_CHECK = PROGRESS_EVENT_LIMIT * 5;
const PROGRESS_COMPACTION_RECLAIM = PROGRESS_EVENT_LIMIT;

/**
 * Rewrites the log as the tail every reader would already have been given:
 * `readProgress` returns at most the last `PROGRESS_EVENT_LIMIT` events of the
 * asking session, so keeping that many per session present in the file changes
 * nothing any reader can observe, and drops what nothing can reach.
 *
 * The caller must hold the progress lock, because this replaces the file that
 * every appender is appending to.
 */
export const compactProgressLog = async ({
  store,
}: {
  readonly store: ReviewStore;
}): Promise<boolean> => {
  const values = await readProgressValues(store.progressPath);
  const nextCheck =
    progressCompactionChecks.get(store.progressPath) ??
    PROGRESS_COMPACTION_CHECK + 1;
  if (values.length < nextCheck) return false;
  // A retained record is written back exactly as it was read. The parsed form
  // is normalized for readers - truncated text, invalid optional fields
  // dropped, unknown fields removed - and compaction only decides which
  // records survive, so rewriting from it would quietly edit the ones it kept.
  const compacted = [...readableProgressHistories(values).values()]
    .flatMap((history) => history.entries.slice(-PROGRESS_EVENT_LIMIT))
    .sort((left, right) => left.index - right.index)
    .map((entry) => values[entry.index] ?? entry.event);
  const reclaimable = values.length - compacted.length;
  if (reclaimable < PROGRESS_COMPACTION_RECLAIM) {
    progressCompactionChecks.set(
      store.progressPath,
      values.length +
        Math.max(
          PROGRESS_EVENT_LIMIT,
          PROGRESS_COMPACTION_RECLAIM - reclaimable,
        ),
    );
    return false;
  }
  await writeFileAtomically({
    path: store.progressPath,
    contents: compacted.map((value) => `${JSON.stringify(value)}\n`).join(""),
  });
  progressLogCaches.delete(store.progressPath);
  progressCompactionChecks.set(
    store.progressPath,
    compacted.length + PROGRESS_COMPACTION_CHECK,
  );
  return true;
};

/** Counts retained records through the same incremental cache used by readers. */
export const progressLogLineCount = async (path: string): Promise<number> =>
  (await readProgressValues(path)).length;
