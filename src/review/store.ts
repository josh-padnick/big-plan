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

import { createHash, randomBytes } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  rename,
  readdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { ReviewComment } from "./shared/comment.js";
import type { FeedbackPackage } from "./feedback-package.js";
import {
  isProgressState,
  isProgressStepCode,
  type ProgressState,
  type ProgressStepCode,
} from "./shared/progress-code.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

// A status file is writable by any local process, so a relayed event carries
// only these states and a bounded amount of text.
const PROGRESS_TEXT_LIMIT = 160;
const PROGRESS_EVENT_LIMIT = 200;
const REVIEW_PLAN_ID_LENGTH = 16;

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

/** One immutable connection transition observed by the review runtime. */
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
  readonly agentPromptPath: string;
  readonly revisionDirectory: string;
  readonly draftsPath: string;
  readonly activeDraftPath: string;
  readonly sentPath: string;
  readonly progressPath: string;
  readonly agentConnectionDirectory: string;
  readonly resolvedPath: string;
  readonly sessionPath: string;
  readonly heartbeatPath: string;
  readonly agentHeartbeatPath: string;
};

/**
 * Namespaces review custody by source location while remaining stable across
 * the source revisions produced during one review.
 */
export const deriveReviewPlanId = ({
  planPath,
}: {
  readonly planPath: string;
}): string =>
  createHash("sha256")
    .update(resolve(planPath))
    .digest("hex")
    .slice(0, REVIEW_PLAN_ID_LENGTH);

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
    agentConnectionDirectory: inside({
      base: agentDirectory,
      leaf: "connections",
    }),
    resolvedPath: inside({ base: reviewDirectory, leaf: "resolved.json" }),
    sessionPath: inside({ base: root, leaf: "session.json" }),
    heartbeatPath: inside({ base: root, leaf: "session-heartbeat.json" }),
    agentHeartbeatPath: inside({
      base: agentDirectory,
      leaf: "agent-heartbeat.json",
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
  await mkdir(store.agentConnectionDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  const ignorePath = inside({ base: store.root, leaf: ".gitignore" });
  try {
    await readFile(ignorePath, "utf8");
  } catch {
    await writeFile(ignorePath, IGNORE_ALL, { mode: FILE_MODE });
  }
  await chmod(ignorePath, FILE_MODE);
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
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    // Readers either retain the previous complete snapshot or open the next
    // complete snapshot; they never observe writeFile's truncate-and-rewrite
    // window and mistake a live review or agent for a disconnected one.
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: FILE_MODE,
    });
    await chmod(temporaryPath, FILE_MODE);
    await rename(temporaryPath, path);
  } catch (error: unknown) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
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
  await chmod(briefPath, FILE_MODE);
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
    value.reason.length <= PROGRESS_TEXT_LIMIT
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
  const accepted = (await readJsonDirectory(store.agentConnectionDirectory))
    .map((value) => asAgentConnectionEvent({ value, sessionId }))
    .filter((event): event is AgentConnectionEvent => event !== undefined);
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
  await writeJson({
    path: inside({
      base: store.agentConnectionDirectory,
      leaf: `${eventId}.json`,
    }),
    value: { ...event, eventId },
  });
};

/** Reads every untrusted request value for validation by the exchange module. */
export const readAgentRequestValues = async (
  store: ReviewStore,
): Promise<ReadonlyArray<unknown>> =>
  readJsonDirectory(store.agentRequestDirectory);

/** Reads one untrusted request value for a locked mailbox change. */
export const readAgentRequestValue = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<unknown> =>
  readJson(exchangePath({ directory: store.agentRequestDirectory, requestId }));

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
  await chmod(store.agentPromptPath, FILE_MODE);
};

/** Reads the untrusted current session value for the authority module. */
export const readSessionDescriptorValue = async (
  store: ReviewStore,
): Promise<unknown> => readJson(store.sessionPath);

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
  let raw: string;
  try {
    raw = await readFile(store.progressPath, "utf8");
  } catch {
    return { events: [], highestSequence: 0 };
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
  }
  return { events: accepted, highestSequence: highest };
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

/** Writes one checked session value for the authority module. */
export const writeSessionDescriptorValue = async ({
  store,
  value,
}: {
  readonly store: ReviewStore;
  readonly value: unknown;
}): Promise<void> => {
  await writeJson({ path: store.sessionPath, value });
};

/** Reads the untrusted session heartbeat for the authority module. */
export const readSessionHeartbeatValue = async (
  store: ReviewStore,
): Promise<unknown> => readJson(store.heartbeatPath);

/** Writes one checked session heartbeat for the authority module. */
export const writeSessionHeartbeatValue = async ({
  store,
  value,
}: {
  readonly store: ReviewStore;
  readonly value: unknown;
}): Promise<void> => {
  await writeJson({ path: store.heartbeatPath, value });
};

export type AgentPresence = {
  readonly connected: boolean;
  readonly state: "waiting" | "working";
  readonly requestId?: string;
  readonly updatedAtMs?: number;
};

/** Refreshes the coding-agent liveness signal with its observable state. */
export const writeAgentHeartbeat = async ({
  store,
  sessionId,
  state,
  requestId,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly state: "waiting" | "working";
  readonly requestId?: string;
  readonly now?: number;
}): Promise<void> => {
  await writeJson({
    path: store.agentHeartbeatPath,
    value: {
      sessionId,
      state,
      ...(requestId === undefined ? {} : { requestId }),
      updatedAtMs: now,
    },
  });
};

/** Reads the coding-agent presence signal without turning stale data into work. */
export const readAgentPresence = async ({
  store,
  sessionId,
  now = Date.now(),
  maximumAgeMs = 3_500,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly now?: number;
  readonly maximumAgeMs?: number;
}): Promise<AgentPresence> => {
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
    !Number.isFinite(value.updatedAtMs) ||
    now - value.updatedAtMs < 0 ||
    now - value.updatedAtMs > maximumAgeMs
  ) {
    return { connected: false, state: "waiting" };
  }
  const requestId =
    "requestId" in value &&
    typeof value.requestId === "string" &&
    /^[a-f0-9]{16}$/.test(value.requestId)
      ? value.requestId
      : undefined;
  return {
    connected: true,
    state: value.state,
    ...(requestId === undefined ? {} : { requestId }),
    updatedAtMs: value.updatedAtMs,
  };
};
