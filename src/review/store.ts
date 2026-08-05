// Owns everything the review runtime keeps on disk, and owns it narrowly: one
// `.big-plan/` directory beside the plan, created owner-only and ignored by
// version control, holding drafts, sent packages, and the agent's progress
// channel.
//
// Two properties are enforced here rather than assumed by callers:
//
//  - No supplied string becomes a path. Every location is built from the
//    resolved plan directory, fixed segments, the renderer's plan id, and
//    filenames this module generates. A resolved path that would land outside
//    the review directory is refused, never clamped back inside.
//  - What is already on disk is untrusted input. `.big-plan/` is writable by
//    anything running as the reviewer, so drafts and progress events are
//    re-checked on read exactly as if they had arrived over the wire.

import { randomBytes } from "node:crypto";
import { lstatSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { FeedbackPackage } from "./feedback-package.js";
import { createFileExclusively, replaceFileAtomically } from "./atomic-file.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

// A status file is writable by any local process, so a relayed event carries
// only these states and a bounded amount of text.
const PROGRESS_STATES = new Set(["waiting", "live", "done", "failed"]);
const PROGRESS_TEXT_LIMIT = 160;
const PROGRESS_EVENT_LIMIT = 200;
const EXCHANGE_FILE_LIMIT = 400;

// Finds the nearest `.big-plan` ancestor so every I/O operation can re-check
// the complete store-owned path immediately before it reaches the filesystem.
const reviewRootForPath = (path: string): string => {
  let current = resolve(path);
  while (basename(current) !== ".big-plan") {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Review path has no .big-plan root: ${path}`);
    }
    current = parent;
  }
  return current;
};

// Existing filesystem entries are untrusted. Refuse every symbolic link from
// the store root through the target rather than allowing writeFile to follow it.
const assertPathHasNoSymbolicLinks = (path: string): void => {
  const candidate = resolve(path);
  const root = reviewRootForPath(candidate);
  const step = relative(root, candidate);
  let current = root;
  for (const segment of step === "" ? [] : step.split(sep)) {
    const status = lstatSync(current, { throwIfNoEntry: false });
    if (status === undefined) {
      return;
    }
    if (status.isSymbolicLink()) {
      throw new Error(
        `Refusing a review path through symbolic link ${current}`,
      );
    }
    current = join(current, segment);
  }
  const status = lstatSync(current, { throwIfNoEntry: false });
  if (status?.isSymbolicLink() === true) {
    throw new Error(`Refusing a review path through symbolic link ${current}`);
  }
};

/** One relayed agent progress event, after checking. */
export type ProgressEvent = {
  readonly eventId: string;
  readonly sessionId: string;
  readonly seq: number;
  readonly step: string;
  readonly state: string;
  readonly detail?: string;
  readonly requestId?: string;
  readonly at?: string;
};

/** The last renewable coding-agent lease, whether or not it is still fresh. */
export type AgentHeartbeat = {
  readonly state: "waiting" | "working";
  readonly updatedAtMs: number;
};

/** One immutable connection transition recorded by the review runtime. */
export type AgentConnectionEvent = {
  readonly eventId?: string;
  readonly sessionId: string;
  readonly connected: boolean;
  readonly at: string;
  readonly reason?: string;
};

/** Where one plan's review state lives. */
export type ReviewStore = {
  readonly root: string;
  readonly reviewDirectory: string;
  readonly feedbackDirectory: string;
  readonly agentRequestDirectory: string;
  readonly agentResponseDirectory: string;
  readonly agentDraftDirectory: string;
  readonly agentClaimDirectory: string;
  readonly agentPromptPath: string;
  readonly revisionDirectory: string;
  readonly reviewerStatePath: string;
  readonly agentCancellationDirectory: string;
  readonly progressDirectory: string;
  readonly agentConnectionDirectory: string;
  readonly sessionPath: string;
  readonly heartbeatPath: string;
  readonly agentHeartbeatPath: string;
};

// The one place a review path is constructed. Callers name a leaf, never a
// path, and a leaf that escaped the review root would be a defect in this
// module rather than something to sanitize away.
const inside = ({
  base,
  leaf,
}: {
  readonly base: string;
  readonly leaf: string;
}): string => {
  const candidate = resolve(base, leaf);
  const step = relative(base, candidate);
  if (step.startsWith("..") || resolve(base, step) !== candidate) {
    throw new Error(`Refusing a review path outside ${base}`);
  }
  assertPathHasNoSymbolicLinks(candidate);
  return candidate;
};

/** Describes where one plan's review state lives, without creating anything. */
export const reviewStoreFor = ({
  planPath,
  planId,
}: {
  readonly planPath: string;
  readonly planId: string;
}): ReviewStore => {
  const root = join(dirname(resolve(planPath)), ".big-plan");
  const reviewDirectory = inside({ base: root, leaf: join("review", planId) });
  const agentDirectory = inside({ base: reviewDirectory, leaf: "agent" });
  return {
    root,
    reviewDirectory,
    feedbackDirectory: inside({ base: root, leaf: "feedback" }),
    agentRequestDirectory: inside({
      base: agentDirectory,
      leaf: "requests",
    }),
    agentResponseDirectory: inside({
      base: agentDirectory,
      leaf: "responses",
    }),
    agentDraftDirectory: inside({
      base: agentDirectory,
      leaf: "drafts",
    }),
    agentClaimDirectory: inside({
      base: agentDirectory,
      leaf: "claims",
    }),
    agentPromptPath: inside({
      base: agentDirectory,
      leaf: "agent-prompt.md",
    }),
    revisionDirectory: inside({
      base: reviewDirectory,
      leaf: "revisions",
    }),
    reviewerStatePath: inside({
      base: reviewDirectory,
      leaf: "reviewer-state.json",
    }),
    agentCancellationDirectory: inside({
      base: agentDirectory,
      leaf: "cancellations",
    }),
    progressDirectory: inside({
      base: agentDirectory,
      leaf: "progress",
    }),
    agentConnectionDirectory: inside({
      base: agentDirectory,
      leaf: "connections",
    }),
    sessionPath: inside({ base: root, leaf: "session.json" }),
    heartbeatPath: inside({ base: root, leaf: "session-heartbeat.json" }),
    agentHeartbeatPath: inside({
      base: agentDirectory,
      leaf: "presence.json",
    }),
  };
};

const IGNORE_ALL =
  "# Review state is local to this machine and never shared.\n*\n";

/** Creates the review directories owner-only and keeps them out of git. */
export const prepareStore = async (store: ReviewStore): Promise<void> => {
  for (const directory of [
    store.reviewDirectory,
    store.feedbackDirectory,
    store.agentRequestDirectory,
    store.agentResponseDirectory,
    store.agentDraftDirectory,
    store.agentClaimDirectory,
    store.revisionDirectory,
    store.agentCancellationDirectory,
    store.progressDirectory,
    store.agentConnectionDirectory,
  ]) {
    assertPathHasNoSymbolicLinks(directory);
    await mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
    assertPathHasNoSymbolicLinks(directory);
  }
  const ignorePath = inside({ base: store.root, leaf: ".gitignore" });
  try {
    await readFile(ignorePath, "utf8");
  } catch {
    await writeFile(ignorePath, IGNORE_ALL, { mode: FILE_MODE });
  }
};

const readJson = async (path: string): Promise<unknown> => {
  try {
    assertPathHasNoSymbolicLinks(path);
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    // A missing, truncated, or hand-edited file means no state, never a crash.
    return undefined;
  }
};

/** Reads one mutable JSON value while preserving invalid-state distinction. */
export const readMutableJson = async ({
  path,
}: {
  readonly path: string;
}): Promise<
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | { readonly kind: "value"; readonly value: unknown }
> => {
  try {
    return {
      kind: "value",
      value: JSON.parse(await readFile(path, "utf8")),
    };
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { kind: "missing" };
    }
    return { kind: "invalid" };
  }
};

const writeJson = async ({
  path,
  value,
}: {
  readonly path: string;
  readonly value: unknown;
}): Promise<void> => {
  assertPathHasNoSymbolicLinks(path);
  await replaceFileAtomically({
    path,
    contents: `${JSON.stringify(value, null, 2)}\n`,
  });
};

/** Atomically writes one validated mutable JSON representation. */
export const writeMutableJson = async ({
  path,
  value,
}: {
  readonly path: string;
  readonly value: unknown;
}): Promise<void> => writeJson({ path, value });

const revisionPath = ({
  store,
  revision,
}: {
  readonly store: ReviewStore;
  readonly revision: string;
}): string => {
  if (!/^[a-f0-9]{16,64}$/.test(revision)) {
    throw new Error("A source revision must be a hexadecimal digest");
  }
  return inside({
    base: store.revisionDirectory,
    leaf: `${revision}.mdx`,
  });
};

/** Retains the authoritative source the first time a revision is observed. */
export const writeRevisionSnapshot = async ({
  store,
  revision,
  source,
}: {
  readonly store: ReviewStore;
  readonly revision: string;
  readonly source: string;
}): Promise<void> => {
  const path = revisionPath({ store, revision });
  try {
    await readFile(path, "utf8");
  } catch {
    await writeFile(path, source, { mode: FILE_MODE, flag: "wx" }).catch(
      async (error: unknown) => {
        // Two request paths may observe the same digest concurrently. A file
        // that now exists is the same immutable revision, not a conflict.
        try {
          await readFile(path, "utf8");
        } catch {
          throw error;
        }
      },
    );
  }
};

/** Reads one immutable source snapshot after validating its digest filename. */
export const readRevisionSnapshot = async ({
  store,
  revision,
}: {
  readonly store: ReviewStore;
  readonly revision: string;
}): Promise<string> => readFile(revisionPath({ store, revision }), "utf8");

/**
 * Writes one feedback package and its brief under names the runtime generates,
 * so no reviewer or plan text ever reaches a filename.
 */
export const writeFeedbackPackage = async ({
  store,
  feedback,
  brief,
}: {
  readonly store: ReviewStore;
  readonly feedback: FeedbackPackage;
  readonly brief: string;
}): Promise<{ readonly jsonPath: string; readonly briefPath: string }> => {
  const stamp = feedback.createdAt.replace(/[^0-9]/g, "").slice(0, 14);
  const name = `${stamp}-${feedback.packageId}`;
  const jsonPath = inside({
    base: store.feedbackDirectory,
    leaf: `${name}.json`,
  });
  const briefPath = inside({
    base: store.feedbackDirectory,
    leaf: `${name}.md`,
  });
  const createIdempotently = async ({
    path,
    contents,
  }: {
    readonly path: string;
    readonly contents: string;
  }): Promise<void> => {
    assertPathHasNoSymbolicLinks(path);
    try {
      await createFileExclusively({ path, contents });
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST" &&
        (await readFile(path, "utf8")) === contents
      ) {
        return;
      }
      throw error;
    }
  };
  await createIdempotently({
    path: jsonPath,
    contents: `${JSON.stringify(feedback, null, 2)}\n`,
  });
  await createIdempotently({ path: briefPath, contents: brief });
  return { jsonPath, briefPath };
};

const exchangePath = ({
  directory,
  requestId,
}: {
  readonly directory: string;
  readonly requestId: string;
}): string => {
  if (!/^[a-f0-9]{16}$/.test(requestId)) {
    throw new Error(
      "An agent exchange request id must be 16 hexadecimal characters",
    );
  }
  return inside({ base: directory, leaf: `${requestId}.json` });
};

const readJsonDirectory = async (
  directory: string,
): Promise<ReadonlyArray<unknown>> => {
  assertPathHasNoSymbolicLinks(directory);
  const names = await readdir(directory).catch(() => []);
  const values: Array<unknown> = [];
  for (const name of names.sort()) {
    if (!/^[a-f0-9]{16}\.json$/.test(name)) {
      continue;
    }
    const value = await readJson(inside({ base: directory, leaf: name }));
    if (value !== undefined) {
      values.push(value);
    }
  }
  return values;
};

/** Creates one opaque immutable JSON fact without replacing an existing id. */
const createJsonRecord = async ({
  directory,
  id,
  value,
}: {
  readonly directory: string;
  readonly id: string;
  readonly value: unknown;
}): Promise<void> => {
  const path = exchangePath({ directory, requestId: id });
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  try {
    await createFileExclusively({ path, contents });
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST" &&
      (await readFile(path, "utf8")) === contents
    ) {
      return;
    }
    throw error;
  }
};

/** Reads every untrusted request value for validation by the exchange module. */
export const readAgentRequestValues = async (
  store: ReviewStore,
): Promise<ReadonlyArray<unknown>> =>
  readJsonDirectory(store.agentRequestDirectory);

/** Reads every untrusted response value for validation by the exchange module. */
export const readAgentResponseValues = async (
  store: ReviewStore,
): Promise<ReadonlyArray<unknown>> =>
  readJsonDirectory(store.agentResponseDirectory);

/** Reads immutable claim values for validation by the exchange module. */
export const readAgentClaimValues = async (
  store: ReviewStore,
): Promise<ReadonlyArray<unknown>> =>
  readJsonDirectory(store.agentClaimDirectory);

/** Records the source revision visible when an agent first claims a request. */
export const writeAgentClaimValue = async ({
  store,
  requestId,
  claimedFromRevision,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly claimedFromRevision: string;
}): Promise<void> => {
  await createJsonRecord({
    directory: store.agentClaimDirectory,
    id: requestId,
    value: { requestId, claimedFromRevision },
  });
};

/** Writes one runtime-authored request under its validated opaque id. */
export const writeAgentRequestValue = async ({
  store,
  requestId,
  value,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly value: unknown;
}): Promise<void> => {
  await createJsonRecord({
    directory: store.agentRequestDirectory,
    id: requestId,
    value,
  });
};

/** Writes one validated agent response under the request it answers. */
export const writeAgentResponseValue = async ({
  store,
  requestId,
  value,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly value: unknown;
}): Promise<void> => {
  await createJsonRecord({
    directory: store.agentResponseDirectory,
    id: requestId,
    value,
  });
};

export type AgentCancellation = {
  readonly requestId: string;
  readonly at: string;
};

/** Reads the durable reviewer-authored request cancellations. */
export const readAgentCancellations = async ({
  store,
}: {
  readonly store: ReviewStore;
}): Promise<ReadonlyArray<AgentCancellation>> => {
  const values = await readJsonDirectory(store.agentCancellationDirectory);
  const accepted: Array<AgentCancellation> = [];
  for (const entry of values.slice(0, EXCHANGE_FILE_LIMIT)) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      Array.isArray(entry) ||
      !("requestId" in entry) ||
      typeof entry.requestId !== "string" ||
      !/^[a-f0-9]{16}$/.test(entry.requestId) ||
      !("at" in entry) ||
      typeof entry.at !== "string" ||
      Number.isNaN(Date.parse(entry.at))
    ) {
      continue;
    }
    if (!accepted.some(({ requestId }) => requestId === entry.requestId)) {
      accepted.push({
        requestId: entry.requestId,
        at: new Date(entry.at).toISOString(),
      });
    }
  }
  return accepted;
};

/** Appends one cancellation without allowing duplicate cancellation facts. */
export const appendAgentCancellation = async ({
  store,
  cancellation,
}: {
  readonly store: ReviewStore;
  readonly cancellation: AgentCancellation;
}): Promise<void> => {
  await createJsonRecord({
    directory: store.agentCancellationDirectory,
    id: cancellation.requestId,
    value: cancellation,
  }).catch((error: unknown) => {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      return;
    }
    throw error;
  });
};

const asAgentConnectionEvent = ({
  value,
  sessionId,
}: {
  readonly value: unknown;
  readonly sessionId: string;
}): AgentConnectionEvent | undefined => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("sessionId" in value) ||
    value.sessionId !== sessionId ||
    !("connected" in value) ||
    typeof value.connected !== "boolean" ||
    !("at" in value) ||
    typeof value.at !== "string" ||
    Number.isNaN(Date.parse(value.at))
  ) {
    return undefined;
  }
  return {
    ...("eventId" in value &&
    typeof value.eventId === "string" &&
    /^[a-f0-9]{16}$/.test(value.eventId)
      ? { eventId: value.eventId }
      : {}),
    sessionId,
    connected: value.connected,
    at: new Date(value.at).toISOString(),
    ...("reason" in value &&
    typeof value.reason === "string" &&
    value.reason.trim() !== "" &&
    value.reason.length <= 160
      ? { reason: value.reason }
      : {}),
  };
};

/** Reads the append-only connection timeline for one review session. */
export const readAgentConnectionEvents = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<ReadonlyArray<AgentConnectionEvent>> => {
  const values = await readJsonDirectory(store.agentConnectionDirectory);
  const accepted: Array<AgentConnectionEvent> = [];
  for (const value of values) {
    const event = asAgentConnectionEvent({ value, sessionId });
    if (event !== undefined) accepted.push(event);
  }
  return accepted.sort((left, right) => {
    const chronological = left.at.localeCompare(right.at);
    return chronological !== 0
      ? chronological
      : (left.eventId ?? "").localeCompare(right.eventId ?? "");
  });
};

/** Appends one runtime-observed connection transition without rewriting history. */
export const appendAgentConnectionEvent = async ({
  store,
  event,
}: {
  readonly store: ReviewStore;
  readonly event: AgentConnectionEvent;
}): Promise<void> => {
  const eventId = event.eventId ?? randomId();
  await createJsonRecord({
    directory: store.agentConnectionDirectory,
    id: eventId,
    value: { ...event, eventId },
  });
};

/** Gives an agent a safe ignored path for authoring one response draft. */
export const agentResponseDraftPath = ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): string => exchangePath({ directory: store.agentDraftDirectory, requestId });

/** Writes the ready-to-paste session contract at a stable ignored path. */
export const writeAgentPrompt = async ({
  store,
  prompt,
}: {
  readonly store: ReviewStore;
  readonly prompt: string;
}): Promise<void> => {
  await writeFile(store.agentPromptPath, `${prompt}\n`, { mode: FILE_MODE });
};

/** Reads the owner-only descriptor through the caller's validator. */
export const readSessionDescriptor = async <Descriptor>({
  store,
  validate,
}: {
  readonly store: ReviewStore;
  readonly validate: (value: unknown) => Descriptor;
}): Promise<Descriptor> => validate(await readJson(store.sessionPath));

/** A random identifier for one package or session. */
export const randomId = (bytes = 8): string =>
  randomBytes(bytes).toString("hex");

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
  if (
    typeof event.eventId !== "string" ||
    !/^[a-f0-9]{16}$/.test(event.eventId)
  ) {
    return undefined;
  }
  if (typeof event.step !== "string" || typeof event.state !== "string") {
    return undefined;
  }
  if (!PROGRESS_STATES.has(event.state)) {
    return undefined;
  }
  return {
    sessionId,
    eventId: event.eventId,
    seq: 0,
    step: event.step.slice(0, PROGRESS_TEXT_LIMIT),
    state: event.state,
    ...(typeof event.detail === "string"
      ? { detail: event.detail.slice(0, PROGRESS_TEXT_LIMIT) }
      : {}),
    ...(typeof event.requestId === "string"
      ? { requestId: event.requestId }
      : {}),
    ...(typeof event.at === "string" ? { at: event.at } : {}),
  };
};

/**
 * Reads independent activity facts in semantic time order and derives their
 * display sequence without coordinating writers.
 */
export const readProgress = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<ReadonlyArray<ProgressEvent>> => {
  assertPathHasNoSymbolicLinks(store.progressDirectory);
  const values = await readJsonDirectory(store.progressDirectory);
  const accepted: Array<ProgressEvent> = [];
  for (const value of values) {
    const event = asProgressEvent({ value, sessionId });
    if (event === undefined) continue;
    accepted.push(event);
  }
  return accepted
    .sort((left, right) => {
      const chronological = (left.at ?? "").localeCompare(right.at ?? "");
      return chronological !== 0
        ? chronological
        : left.eventId.localeCompare(right.eventId);
    })
    .slice(-PROGRESS_EVENT_LIMIT)
    .map((event, index) => ({ ...event, seq: index + 1 }));
};

/** Appends one runtime-authored event to the agent's status channel. */
export const appendProgress = async ({
  store,
  event,
}: {
  readonly store: ReviewStore;
  readonly event: Omit<ProgressEvent, "eventId" | "seq"> & {
    readonly eventId?: string;
  };
}): Promise<void> => {
  assertPathHasNoSymbolicLinks(store.progressDirectory);
  const eventId = event.eventId ?? randomId();
  await createJsonRecord({
    directory: store.progressDirectory,
    id: eventId,
    value: { ...event, eventId },
  });
};

/** Records the running session so a reviewer (and only they) can find it. */
export const writeSessionDescriptor = async ({
  store,
  descriptor,
}: {
  readonly store: ReviewStore;
  readonly descriptor: Readonly<Record<string, unknown>>;
}): Promise<void> => {
  await writeJson({ path: store.sessionPath, value: descriptor });
};

/** Updates the filesystem-only liveness signal coding-agent sandboxes read. */
export const writeSessionHeartbeat = async ({
  store,
  sessionId,
  running,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly running: boolean;
  readonly now?: number;
}): Promise<void> => {
  await writeJson({
    path: store.heartbeatPath,
    value: { sessionId, running, updatedAtMs: now },
  });
};

/** Checks whether the matching review runtime has refreshed its heartbeat. */
export const sessionHeartbeatIsFresh = async ({
  store,
  sessionId,
  now = Date.now(),
  maximumAgeMs = 3_000,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly now?: number;
  readonly maximumAgeMs?: number;
}): Promise<boolean> => {
  const value = await readJson(store.heartbeatPath);
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "sessionId" in value &&
    value.sessionId === sessionId &&
    "running" in value &&
    value.running === true &&
    "updatedAtMs" in value &&
    typeof value.updatedAtMs === "number" &&
    Number.isFinite(value.updatedAtMs) &&
    now - value.updatedAtMs >= 0 &&
    now - value.updatedAtMs <= maximumAgeMs
  );
};

/** Records that the coding-agent loop is available for this review session. */
export const writeAgentHeartbeat = async ({
  store,
  sessionId,
  state,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly state: "waiting" | "working";
  readonly now?: number;
}): Promise<void> => {
  await writeJson({
    path: store.agentHeartbeatPath,
    value: { sessionId, state, updatedAtMs: now },
  });
};

/** Reads the validated coding-agent lease without applying an age cutoff. */
export const readAgentHeartbeat = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<AgentHeartbeat | undefined> => {
  const value = await readJson(store.agentHeartbeatPath);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("sessionId" in value) ||
    value.sessionId !== sessionId ||
    !("state" in value) ||
    (value.state !== "waiting" && value.state !== "working") ||
    !("updatedAtMs" in value) ||
    typeof value.updatedAtMs !== "number" ||
    !Number.isFinite(value.updatedAtMs)
  ) {
    return undefined;
  }
  return { state: value.state, updatedAtMs: value.updatedAtMs };
};

/**
 * Checks the agent's renewable lease. Waiting loops refresh frequently;
 * claimed work gets a longer lease so queued follow-up requests stay Waiting.
 */
export const agentHeartbeatIsFresh = async ({
  store,
  sessionId,
  now = Date.now(),
  waitingMaximumAgeMs = 3_000,
  workingMaximumAgeMs = 90_000,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly now?: number;
  readonly waitingMaximumAgeMs?: number;
  readonly workingMaximumAgeMs?: number;
}): Promise<boolean> => {
  const value = await readAgentHeartbeat({ store, sessionId });
  if (value === undefined) return false;
  const age = now - value.updatedAtMs;
  const maximumAge =
    value.state === "waiting" ? waitingMaximumAgeMs : workingMaximumAgeMs;
  return age >= 0 && age <= maximumAge;
};
