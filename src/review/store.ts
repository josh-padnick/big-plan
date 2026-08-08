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
const REVIEW_PLAN_ID_LENGTH = 16;

/** One relayed agent progress event, after checking. */
export type ProgressEvent = {
  readonly sessionId: string;
  readonly seq: number;
  readonly step: string;
  readonly state: string;
  readonly detail?: string;
};

/** Where one plan's review state lives. */
export type ReviewStore = {
  readonly root: string;
  readonly reviewDirectory: string;
  readonly feedbackDirectory: string;
  readonly draftsPath: string;
  readonly activeDraftPath: string;
  readonly sentPath: string;
  readonly progressPath: string;
  readonly sessionPath: string;
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
  return {
    root,
    reviewDirectory,
    feedbackDirectory: inside({ base: root, leaf: "feedback" }),
    draftsPath: inside({ base: reviewDirectory, leaf: "drafts.json" }),
    activeDraftPath: inside({
      base: reviewDirectory,
      leaf: "active-draft.json",
    }),
    sentPath: inside({ base: reviewDirectory, leaf: "sent.json" }),
    progressPath: inside({ base: reviewDirectory, leaf: "progress.jsonl" }),
    sessionPath: inside({ base: root, leaf: "session.json" }),
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
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    mode: FILE_MODE,
  });
  await chmod(path, FILE_MODE);
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
  await appendFile(store.progressPath, `${JSON.stringify(event)}\n`, {
    mode: FILE_MODE,
  });
  await chmod(store.progressPath, FILE_MODE);
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
