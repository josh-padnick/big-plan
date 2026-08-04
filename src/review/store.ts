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
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { ReviewComment } from "./comment.js";
import type { FeedbackPackage } from "./feedback-package.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

// A status file is writable by any local process, so a relayed event carries
// only these states and a bounded amount of text.
const PROGRESS_STATES = new Set(["waiting", "live", "done", "failed"]);
const PROGRESS_TEXT_LIMIT = 160;
const PROGRESS_EVENT_LIMIT = 200;
const EXCHANGE_FILE_LIMIT = 400;

/** One relayed agent progress event, after checking. */
export type ProgressEvent = {
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
  readonly sessionId: string;
  readonly connected: boolean;
  readonly at: string;
};

/** Where one plan's review state lives. */
export type ReviewStore = {
  readonly root: string;
  readonly reviewDirectory: string;
  readonly feedbackDirectory: string;
  readonly agentRequestDirectory: string;
  readonly agentResponseDirectory: string;
  readonly agentDraftDirectory: string;
  readonly agentPromptPath: string;
  readonly revisionDirectory: string;
  readonly draftsPath: string;
  readonly activeDraftPath: string;
  readonly sentPath: string;
  readonly progressPath: string;
  readonly resolvedPath: string;
  readonly sessionPath: string;
  readonly heartbeatPath: string;
  readonly agentHeartbeatPath: string;
  readonly agentCancellationsPath: string;
  readonly agentConnectionEventsPath: string;
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
    agentPromptPath: inside({
      base: agentDirectory,
      leaf: "agent-prompt.md",
    }),
    revisionDirectory: inside({
      base: reviewDirectory,
      leaf: "revisions",
    }),
    draftsPath: inside({ base: reviewDirectory, leaf: "drafts.json" }),
    activeDraftPath: inside({
      base: reviewDirectory,
      leaf: "active-draft.json",
    }),
    sentPath: inside({ base: reviewDirectory, leaf: "sent.json" }),
    progressPath: inside({ base: reviewDirectory, leaf: "progress.jsonl" }),
    resolvedPath: inside({ base: reviewDirectory, leaf: "resolved.json" }),
    sessionPath: inside({ base: root, leaf: "session.json" }),
    heartbeatPath: inside({ base: root, leaf: "session-heartbeat.json" }),
    agentHeartbeatPath: inside({
      base: agentDirectory,
      leaf: "presence.json",
    }),
    agentCancellationsPath: inside({
      base: agentDirectory,
      leaf: "cancellations.json",
    }),
    agentConnectionEventsPath: inside({
      base: agentDirectory,
      leaf: "connection-events.jsonl",
    }),
  };
};

const IGNORE_ALL =
  "# Review state is local to this machine and never shared.\n*\n";

/** Creates the review directories owner-only and keeps them out of git. */
export const prepareStore = async (store: ReviewStore): Promise<void> => {
  await mkdir(store.reviewDirectory, { recursive: true, mode: DIRECTORY_MODE });
  await mkdir(store.feedbackDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  await mkdir(store.agentRequestDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  await mkdir(store.agentResponseDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  await mkdir(store.agentDraftDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  await mkdir(store.revisionDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  const ignorePath = inside({ base: store.root, leaf: ".gitignore" });
  try {
    await readFile(ignorePath, "utf8");
  } catch {
    await writeFile(ignorePath, IGNORE_ALL, { mode: FILE_MODE });
  }
};

const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    // A missing, truncated, or hand-edited file means no state, never a crash.
    return undefined;
  }
};

const writeJson = async ({
  path,
  value,
}: {
  readonly path: string;
  readonly value: unknown;
}): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    mode: FILE_MODE,
  });
};

/** Reads a stored comment list back through the caller's own validator. */
export const readComments = async ({
  path,
  validate,
}: {
  readonly path: string;
  readonly validate: (value: unknown) => ReadonlyArray<ReviewComment>;
}): Promise<ReadonlyArray<ReviewComment>> => {
  const stored = await readJson(path);
  if (stored === undefined) {
    return [];
  }
  try {
    return validate(stored);
  } catch {
    // A file that no longer validates against this document is stale state,
    // not an error the reviewer can act on.
    return [];
  }
};

/** Replaces the stored comment list at one path. */
export const writeComments = async ({
  path,
  comments,
}: {
  readonly path: string;
  readonly comments: ReadonlyArray<ReviewComment>;
}): Promise<void> => {
  await writeJson({ path, value: comments });
};

/** Reads the whole-plan field through the caller's bounded validator. */
export const readActiveDraft = async ({
  path,
  validate,
}: {
  readonly path: string;
  readonly validate: (value: unknown) => string;
}): Promise<string> => {
  const stored = await readJson(path);
  try {
    return validate(stored);
  } catch {
    return "";
  }
};

/** Replaces the persisted whole-plan field without trimming reviewer text. */
export const writeActiveDraft = async ({
  path,
  value,
}: {
  readonly path: string;
  readonly value: string;
}): Promise<void> => {
  await writeJson({ path, value });
};

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

/** Reads the durable set of locally resolved thread ids. */
export const readResolvedCommentIds = async ({
  store,
  validate,
}: {
  readonly store: ReviewStore;
  readonly validate: (value: unknown) => ReadonlyArray<string>;
}): Promise<ReadonlyArray<string>> => {
  const value = await readJson(store.resolvedPath);
  try {
    return validate(value);
  } catch {
    return [];
  }
};

/** Replaces the durable resolved-thread set. */
export const writeResolvedCommentIds = async ({
  store,
  ids,
}: {
  readonly store: ReviewStore;
  readonly ids: ReadonlyArray<string>;
}): Promise<void> => {
  await writeJson({ path: store.resolvedPath, value: ids });
};

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
  await writeJson({ path: jsonPath, value: feedback });
  await writeFile(briefPath, brief, { mode: FILE_MODE });
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
  await writeJson({
    path: exchangePath({
      directory: store.agentRequestDirectory,
      requestId,
    }),
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
  await writeJson({
    path: exchangePath({
      directory: store.agentResponseDirectory,
      requestId,
    }),
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
  const value = await readJson(store.agentCancellationsPath);
  if (!Array.isArray(value)) return [];
  const accepted: Array<AgentCancellation> = [];
  for (const entry of value.slice(0, EXCHANGE_FILE_LIMIT)) {
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
  const existing = await readAgentCancellations({ store });
  if (existing.some(({ requestId }) => requestId === cancellation.requestId)) {
    return;
  }
  await writeJson({
    path: store.agentCancellationsPath,
    value: [...existing, cancellation],
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
    sessionId,
    connected: value.connected,
    at: new Date(value.at).toISOString(),
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
  const raw = await readFile(store.agentConnectionEventsPath, "utf8").catch(
    () => "",
  );
  const accepted: Array<AgentConnectionEvent> = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    const event = asAgentConnectionEvent({ value, sessionId });
    if (event !== undefined) accepted.push(event);
  }
  return accepted;
};

/** Appends one runtime-observed connection transition without rewriting history. */
export const appendAgentConnectionEvent = async ({
  store,
  event,
}: {
  readonly store: ReviewStore;
  readonly event: AgentConnectionEvent;
}): Promise<void> => {
  await appendFile(
    store.agentConnectionEventsPath,
    `${JSON.stringify(event)}\n`,
    { mode: FILE_MODE },
  );
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
  if (typeof event.seq !== "number" || !Number.isInteger(event.seq)) {
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
    seq: event.seq,
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
 * Relays the agent's status channel: line-delimited events, kept only when
 * they belong to the running session and advance its sequence. A foreign or
 * out-of-order event is dropped rather than shown to the reviewer as live.
 */
export const readProgress = async ({
  store,
  sessionId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
}): Promise<ReadonlyArray<ProgressEvent>> => {
  let raw: string;
  try {
    raw = await readFile(store.progressPath, "utf8");
  } catch {
    return [];
  }
  const accepted: Array<ProgressEvent> = [];
  let highest = 0;
  for (const line of raw.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const event = asProgressEvent({ value: parsed, sessionId });
    if (event === undefined || event.seq <= highest) {
      continue;
    }
    highest = event.seq;
    accepted.push(event);
    if (accepted.length >= PROGRESS_EVENT_LIMIT) {
      break;
    }
  }
  return accepted;
};

/** Appends one runtime-authored event to the agent's status channel. */
export const appendProgress = async ({
  store,
  event,
}: {
  readonly store: ReviewStore;
  readonly event: ProgressEvent;
}): Promise<void> => {
  const existing = await readFile(store.progressPath, "utf8").catch(() => "");
  await writeFile(store.progressPath, `${existing}${JSON.stringify(event)}\n`, {
    mode: FILE_MODE,
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
