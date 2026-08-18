// Owns everything the review runtime keeps on disk, and owns it narrowly: one
// `.big-plan/` directory beside the plan, created owner-only and ignored by
// version control, holding drafts, sent packages, immutable source snapshots,
// and the agent's progress
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
import { lstatSync, realpathSync } from "node:fs";
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  open,
  rename,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { readBoundedRegularFile } from "./bounded-regular-file.js";
import type { ReviewComment } from "./shared/comment.js";
import type { FeedbackPackage } from "./feedback-package.js";
import type { StagedInputs } from "./plan-inputs-store.js";
import type { StoredChangeDispositions } from "./change-dispositions-store.js";
import {
  isReviewImageId,
  isReviewImageWithinLimits,
  MAX_IMAGE_BYTES,
  probeReviewImageDimensions,
  reviewImageId,
  sniffReviewImage,
  type ReviewImageAttachment,
  type ReviewImageDescriptor,
} from "./shared/review-image.js";
import { AGENT_STALL_MS } from "./shared/agent-status.js";
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
const REVIEW_IMAGE_METADATA_BYTES = 4096;
const PUBLISHED_JSON_FILE = /^[a-f0-9]{16}\.json$/;

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
  readonly planDirectory: string;
  readonly planId: string;
  readonly root: string;
  readonly reviewDirectory: string;
  readonly imagesDirectory: string;
  readonly requestAttachmentsDirectory: string;
  readonly feedbackDirectory: string;
  readonly feedbackSubmissionDirectory: string;
  readonly agentRequestDirectory: string;
  readonly agentResponseDirectory: string;
  readonly committedRevisionDirectory: string;
  readonly agentMutationDirectory: string;
  readonly agentMutationJournalDirectory: string;
  readonly agentPromptPath: string;
  readonly snapshotDirectory: string;
  readonly draftsPath: string;
  readonly inputsPath: string;
  readonly changeDispositionsPath: string;
  readonly sentPath: string;
  readonly progressPath: string;
  readonly agentConnectionDirectory: string;
  readonly resolvedPath: string;
  readonly sessionPath: string;
  readonly heartbeatPath: string;
  readonly sessionLockPath: string;
  readonly heartbeatLockPath: string;
  readonly agentHeartbeatPath: string;
  readonly agentHeartbeatLockPath: string;
};

/**
 * Namespaces review custody by source location while remaining stable across
 * the source snapshots produced during one review.
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

const hasCode = (
  error: unknown,
  code: string,
): error is Error & { readonly code: string } =>
  error instanceof Error && "code" in error && error.code === code;

export type ReviewStorePathRejection = "outside" | "unavailable";

export class ReviewStorePathRejected extends Error {
  readonly reason: ReviewStorePathRejection;

  constructor(reason: ReviewStorePathRejection, cause?: unknown) {
    super(
      reason === "outside"
        ? "Refusing a review store path outside its anchored chain"
        : "The anchored review store path is unavailable",
      { cause },
    );
    this.name = "ReviewStorePathRejected";
    this.reason = reason;
  }
}

type AnchoredStorePath = {
  readonly path: string;
  readonly exists: boolean;
};

export type ReviewStoreDirectoryKey = {
  [Key in keyof ReviewStore]: Key extends "root" | `${string}Directory`
    ? Key
    : never;
}[keyof ReviewStore];

type ReviewStorePathKey = {
  [Key in keyof ReviewStore]: Key extends `${string}Path` ? Key : never;
}[keyof ReviewStore];

type ReviewStoreLocationKey = ReviewStoreDirectoryKey | ReviewStorePathKey;

export type AnchoredReviewStore = {
  readonly resolveStore: () => Promise<ReviewStore>;
  readonly resolveDirectoryPath: (options: {
    readonly directory: ReviewStoreDirectoryKey;
    readonly requestId?: string;
    readonly targetPath?: string;
    readonly allowMissingRequestDirectory?: boolean;
  }) => Promise<AnchoredStorePath>;
};

const isReviewStoreDirectoryKey = (
  key: string,
): key is ReviewStoreDirectoryKey =>
  key === "root" || key.endsWith("Directory");

const isReviewStoreLocationKey = (key: string): key is ReviewStoreLocationKey =>
  isReviewStoreDirectoryKey(key) || key.endsWith("Path");

const reviewStoreLocationKeys = (
  store: ReviewStore,
): ReadonlyArray<ReviewStoreLocationKey> =>
  Object.keys(store).filter(isReviewStoreLocationKey);

/** Resolves one constructed store location without requiring absent state. */
const resolveConstructedSegments = ({
  base,
  segments,
  directory,
}: {
  readonly base: string;
  readonly segments: ReadonlyArray<string>;
  readonly directory: boolean;
}): string => {
  let current = base;
  for (const [index, segment] of segments.entries()) {
    const expected = inside({ base: current, leaf: segment });
    try {
      const entry = lstatSync(expected);
      if (
        entry.isSymbolicLink() ||
        ((index < segments.length - 1 || directory) && !entry.isDirectory())
      ) {
        throw new ReviewStorePathRejected("outside");
      }
      const canonical = realpathSync(expected);
      if (canonical !== expected) {
        throw new ReviewStorePathRejected("outside");
      }
      current = canonical;
    } catch (error: unknown) {
      if (error instanceof ReviewStorePathRejected) throw error;
      if (hasCode(error, "ENOENT")) {
        return resolve(current, ...segments.slice(index));
      }
      throw new ReviewStorePathRejected("unavailable", error);
    }
  }
  return current;
};

/** Canonicalizes every location represented by a ReviewStore value. */
const canonicalReviewStore = (store: ReviewStore): ReviewStore => {
  const lexicalPlanDirectory = resolve(store.planDirectory);
  let planDirectory: string;
  try {
    planDirectory = realpathSync(lexicalPlanDirectory);
  } catch (error: unknown) {
    throw new ReviewStorePathRejected("unavailable", error);
  }
  const locations: Record<string, string> = {};
  for (const location of reviewStoreLocationKeys(store)) {
    const lexicalLocation = resolve(store[location]);
    const step = relative(lexicalPlanDirectory, lexicalLocation);
    if (
      step.startsWith("..") ||
      resolve(lexicalPlanDirectory, step) !== lexicalLocation
    ) {
      throw new ReviewStorePathRejected("outside");
    }
    locations[location] = resolveConstructedSegments({
      base: planDirectory,
      segments: step === "" ? [] : step.split(sep),
      directory: isReviewStoreDirectoryKey(location),
    });
  }
  return { ...store, ...locations };
};

const resolveAnchoredSegments = async ({
  base,
  segments,
  allowMissingLast = false,
}: {
  readonly base: string;
  readonly segments: ReadonlyArray<string>;
  readonly allowMissingLast?: boolean;
}): Promise<AnchoredStorePath> => {
  let current = base;
  for (const [index, segment] of segments.entries()) {
    const expected = inside({ base: current, leaf: segment });
    try {
      const canonical = await realpath(expected);
      if (canonical !== expected) {
        throw new ReviewStorePathRejected("outside");
      }
      current = canonical;
    } catch (error: unknown) {
      if (error instanceof ReviewStorePathRejected) throw error;
      if (
        allowMissingLast &&
        index === segments.length - 1 &&
        hasCode(error, "ENOENT")
      ) {
        return { path: expected, exists: false };
      }
      throw new ReviewStorePathRejected("unavailable", error);
    }
  }
  return { path: current, exists: true };
};

export const anchorReviewStore = async (
  store: ReviewStore,
): Promise<AnchoredReviewStore> => {
  const lexicalPlanDirectory = resolve(store.planDirectory);
  let planDirectory: string;
  try {
    planDirectory = await realpath(store.planDirectory);
  } catch (error: unknown) {
    throw new ReviewStorePathRejected("unavailable", error);
  }
  const directories = new Map<
    ReviewStoreDirectoryKey,
    Promise<AnchoredStorePath>
  >();
  const resolveDirectory = (
    directory: ReviewStoreDirectoryKey,
  ): Promise<AnchoredStorePath> => {
    const existing = directories.get(directory);
    if (existing !== undefined) return existing;
    const lexicalDirectory = resolve(store[directory]);
    const step = [lexicalPlanDirectory, planDirectory]
      .map((base) => ({ base, step: relative(base, lexicalDirectory) }))
      .find(
        (candidate) =>
          !candidate.step.startsWith("..") &&
          resolve(candidate.base, candidate.step) === lexicalDirectory,
      )?.step;
    if (step === undefined) {
      return Promise.reject(new ReviewStorePathRejected("outside"));
    }
    const resolved = resolveAnchoredSegments({
      base: planDirectory,
      segments: step === "" ? [] : step.split(sep),
    });
    directories.set(directory, resolved);
    return resolved;
  };
  await resolveDirectory("reviewDirectory");
  return {
    resolveStore: async () => {
      const resolvedLocations: Record<string, string> = {};
      await Promise.all(
        reviewStoreLocationKeys(store).map(async (location) => {
          if (isReviewStoreDirectoryKey(location)) {
            resolvedLocations[location] = (
              await resolveDirectory(location)
            ).path;
            return;
          }
          const lexicalLocation = resolve(store[location]);
          const step = relative(lexicalPlanDirectory, lexicalLocation);
          if (
            step.startsWith("..") ||
            resolve(lexicalPlanDirectory, step) !== lexicalLocation
          ) {
            throw new ReviewStorePathRejected("outside");
          }
          resolvedLocations[location] = (
            await resolveAnchoredSegments({
              base: planDirectory,
              segments: step === "" ? [] : step.split(sep),
              allowMissingLast: true,
            })
          ).path;
        }),
      );
      return { ...store, ...resolvedLocations };
    },
    resolveDirectoryPath: async ({
      directory,
      requestId,
      targetPath,
      allowMissingRequestDirectory = false,
    }) => {
      if (requestId !== undefined && !/^[a-f0-9]{16}$/.test(requestId)) {
        throw new ReviewStorePathRejected("outside");
      }
      const areaPath = await resolveDirectory(directory);
      if (requestId === undefined) {
        if (targetPath !== undefined) {
          throw new ReviewStorePathRejected("outside");
        }
        return areaPath;
      }
      let targetSegments: ReadonlyArray<string> | undefined;
      if (targetPath !== undefined) {
        if (directory !== "requestAttachmentsDirectory") {
          throw new ReviewStorePathRejected("outside");
        }
        const lexicalRequestPath = resolve(store[directory], requestId);
        const lexicalTargetPath = resolve(targetPath);
        const step = relative(lexicalRequestPath, lexicalTargetPath);
        if (
          step === "" ||
          step.startsWith("..") ||
          resolve(lexicalRequestPath, step) !== lexicalTargetPath
        ) {
          throw new ReviewStorePathRejected("outside");
        }
        targetSegments = step.split(sep);
      }
      const requestPath = await resolveAnchoredSegments({
        base: areaPath.path,
        segments: [requestId],
        allowMissingLast: allowMissingRequestDirectory,
      });
      if (targetSegments === undefined || !requestPath.exists)
        return requestPath;
      return resolveAnchoredSegments({
        base: requestPath.path,
        segments: targetSegments,
      });
    },
  };
};

/** Describes where one plan's review state lives, without creating anything. */
export const reviewStoreFor = ({
  planPath,
  planId,
}: {
  readonly planPath: string;
  readonly planId: string;
}): ReviewStore => {
  const planDirectory = dirname(resolve(planPath));
  const root = join(planDirectory, ".big-plan");
  const reviewDirectory = inside({ base: root, leaf: join("review", planId) });
  const agentDirectory = inside({ base: reviewDirectory, leaf: "agent" });
  return canonicalReviewStore({
    planDirectory,
    planId,
    root,
    reviewDirectory,
    imagesDirectory: inside({ base: reviewDirectory, leaf: "images" }),
    requestAttachmentsDirectory: inside({
      base: agentDirectory,
      leaf: "attachments",
    }),
    feedbackDirectory: inside({ base: root, leaf: "feedback" }),
    feedbackSubmissionDirectory: inside({
      base: reviewDirectory,
      leaf: "feedback-submissions",
    }),
    agentRequestDirectory: inside({
      base: agentDirectory,
      leaf: "requests",
    }),
    agentResponseDirectory: inside({
      base: agentDirectory,
      leaf: "responses",
    }),
    committedRevisionDirectory: inside({
      base: reviewDirectory,
      leaf: "committed-revisions",
    }),
    agentMutationDirectory: inside({
      base: agentDirectory,
      leaf: "mutations",
    }),
    agentMutationJournalDirectory: inside({
      base: agentDirectory,
      leaf: "mutation-journal",
    }),
    agentPromptPath: inside({
      base: agentDirectory,
      leaf: "agent-prompt.md",
    }),
    snapshotDirectory: inside({
      base: reviewDirectory,
      leaf: "snapshots",
    }),
    draftsPath: inside({ base: reviewDirectory, leaf: "drafts.json" }),
    inputsPath: inside({ base: reviewDirectory, leaf: "inputs.json" }),
    changeDispositionsPath: inside({
      base: reviewDirectory,
      leaf: "dispositions.json",
    }),
    sentPath: inside({ base: reviewDirectory, leaf: "sent.json" }),
    progressPath: inside({ base: reviewDirectory, leaf: "progress.jsonl" }),
    agentConnectionDirectory: inside({
      base: agentDirectory,
      leaf: "connections",
    }),
    resolvedPath: inside({ base: reviewDirectory, leaf: "resolved.json" }),
    sessionPath: inside({ base: reviewDirectory, leaf: "session.json" }),
    heartbeatPath: inside({
      base: reviewDirectory,
      leaf: "session-heartbeat.json",
    }),
    sessionLockPath: inside({
      base: reviewDirectory,
      leaf: ".session-authority.lock",
    }),
    // The heartbeat is deliberately not serialized against mutations: a
    // mutation that never settles must not be able to stop the session from
    // reporting that it is still alive.
    heartbeatLockPath: inside({
      base: reviewDirectory,
      leaf: ".session-heartbeat.lock",
    }),
    agentHeartbeatPath: inside({
      base: agentDirectory,
      leaf: "agent-heartbeat.json",
    }),
    // Both writers of the agent heartbeat take this one. The observed-end
    // marker is a read-compare-write, so without it a newer loop's first
    // heartbeat can land between the comparison and the write it guards, and
    // a live agent gets a durable end recorded against it.
    agentHeartbeatLockPath: inside({
      base: agentDirectory,
      leaf: ".agent-heartbeat.lock",
    }),
  });
};

const IGNORE_ALL =
  "# Review state is local to this machine and never shared.\n*\n";

const migrateLegacySnapshots = async (store: ReviewStore): Promise<void> => {
  const legacyDirectory = inside({
    base: store.reviewDirectory,
    leaf: "revisions",
  });
  let entries;
  try {
    entries = await readdir(legacyDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{16,64}\.mdx$/.test(entry.name)) {
      continue;
    }
    const sourcePath = inside({ base: legacyDirectory, leaf: entry.name });
    const targetPath = inside({
      base: store.snapshotDirectory,
      leaf: entry.name,
    });
    const source = await readFile(sourcePath, "utf8");
    await writeFile(targetPath, source, { mode: FILE_MODE, flag: "wx" }).catch(
      async (error: unknown) => {
        try {
          await readFile(targetPath, "utf8");
        } catch {
          throw error;
        }
      },
    );
  }
};

/** Creates the review directories owner-only and keeps them out of git. */
export const prepareStore = async (store: ReviewStore): Promise<void> => {
  await mkdir(store.reviewDirectory, { recursive: true, mode: DIRECTORY_MODE });
  await mkdir(store.imagesDirectory, { recursive: true, mode: DIRECTORY_MODE });
  await mkdir(store.feedbackDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  await mkdir(store.feedbackSubmissionDirectory, {
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
  await mkdir(store.committedRevisionDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  await mkdir(store.agentMutationDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  await mkdir(store.agentMutationJournalDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  await mkdir(store.requestAttachmentsDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  await mkdir(store.snapshotDirectory, {
    recursive: true,
    mode: DIRECTORY_MODE,
  });
  await migrateLegacySnapshots(store);
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

export const readStoreJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    // A missing, truncated, or hand-edited file means no state, never a crash.
    return undefined;
  }
};

type StoredReviewImage = {
  readonly descriptor: ReviewImageDescriptor;
  readonly bytes: Uint8Array;
};

const imageDirectory = (store: ReviewStore, id: string): string => {
  if (!isReviewImageId(id)) throw new Error("Invalid review image id");
  return inside({ base: store.imagesDirectory, leaf: id });
};

const imageMetadataPath = (store: ReviewStore, id: string): string =>
  inside({ base: imageDirectory(store, id), leaf: "metadata.json" });

const imageBytesPath = (
  store: ReviewStore,
  id: string,
  extension: string,
): string =>
  inside({ base: imageDirectory(store, id), leaf: `image.${extension}` });

const checkedImageMetadata = (
  value: unknown,
): ReviewImageDescriptor | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    !isReviewImageId(candidate.id) ||
    typeof candidate.alt !== "string" ||
    (candidate.mimeType !== "image/png" &&
      candidate.mimeType !== "image/jpeg" &&
      candidate.mimeType !== "image/webp") ||
    typeof candidate.byteLength !== "number" ||
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number" ||
    !Number.isInteger(candidate.byteLength) ||
    !Number.isInteger(candidate.width) ||
    !Number.isInteger(candidate.height) ||
    !isReviewImageWithinLimits({
      byteLength: candidate.byteLength,
      width: candidate.width,
      height: candidate.height,
    })
  )
    return undefined;
  return {
    id: candidate.id,
    alt: candidate.alt,
    mimeType: candidate.mimeType,
    byteLength: candidate.byteLength,
    width: candidate.width,
    height: candidate.height,
  };
};

/** Reads a published image only when metadata, bytes, and MIME agree. */
export const readReviewImage = async ({
  store,
  id,
}: {
  readonly store: ReviewStore;
  readonly id: string;
}): Promise<StoredReviewImage | undefined> => {
  try {
    const metadataBytes = await readBoundedRegularFile({
      path: imageMetadataPath(store, id),
      maxBytes: REVIEW_IMAGE_METADATA_BYTES,
      expectedIdentity: null,
    });
    if (metadataBytes === undefined) return undefined;
    const descriptor = checkedImageMetadata(
      JSON.parse(new TextDecoder().decode(metadataBytes)),
    );
    if (descriptor === undefined) return undefined;
    const extension =
      descriptor.mimeType === "image/jpeg"
        ? "jpg"
        : descriptor.mimeType.slice("image/".length);
    const bytes = await readBoundedRegularFile({
      path: imageBytesPath(store, id, extension),
      maxBytes: Math.min(descriptor.byteLength, MAX_IMAGE_BYTES),
      expectedIdentity: null,
    });
    if (bytes === undefined) return undefined;
    const format = sniffReviewImage(bytes);
    const dimensions = probeReviewImageDimensions(bytes, format);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (
      format?.mimeType !== descriptor.mimeType ||
      bytes.byteLength !== descriptor.byteLength ||
      digest !== descriptor.id ||
      dimensions?.width !== descriptor.width ||
      dimensions?.height !== descriptor.height
    )
      return undefined;
    return { descriptor, bytes };
  } catch {
    return undefined;
  }
};

/** Publishes one image under its server-derived SHA-256 digest. */
export const publishReviewImage = async ({
  store,
  bytes,
  alt,
}: {
  readonly store: ReviewStore;
  readonly bytes: Uint8Array;
  readonly alt: string;
}): Promise<ReviewImageDescriptor> => {
  const format = sniffReviewImage(bytes);
  const dimensions = probeReviewImageDimensions(bytes, format);
  if (
    format === undefined ||
    dimensions === undefined ||
    !isReviewImageWithinLimits({ byteLength: bytes.byteLength, ...dimensions })
  ) {
    throw new Error("The image is invalid or exceeds the supported limits");
  }
  const id = reviewImageId(createHash("sha256").update(bytes).digest("hex"));
  const existing = await readReviewImage({ store, id });
  if (existing !== undefined) return existing.descriptor;
  const descriptor: ReviewImageDescriptor = {
    id,
    alt,
    mimeType: format.mimeType,
    byteLength: bytes.byteLength,
    ...dimensions,
  };
  const temporary = inside({
    base: store.imagesDirectory,
    leaf: `.image-${id}-${randomBytes(6).toString("hex")}`,
  });
  await mkdir(temporary, { recursive: true, mode: DIRECTORY_MODE });
  try {
    await writeFile(
      inside({ base: temporary, leaf: `image.${format.extension}` }),
      bytes,
      { mode: FILE_MODE },
    );
    await writeStoreJson({
      path: inside({ base: temporary, leaf: "metadata.json" }),
      value: descriptor,
    });
    await rename(temporary, imageDirectory(store, id));
  } catch (error: unknown) {
    await rm(temporary, { recursive: true, force: true });
    const deduped = await readReviewImage({ store, id });
    if (deduped !== undefined) return deduped.descriptor;
    throw error;
  }
  return descriptor;
};

/** Freezes published blobs into request-owned copies before mailbox delivery. */
export const freezeRequestAttachments = async ({
  store,
  requestId,
  references,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
  readonly references: ReadonlyArray<{
    readonly id: string;
    readonly alt: string;
  }>;
}): Promise<ReadonlyArray<ReviewImageAttachment>> => {
  if (!/^[a-f0-9]{16}$/.test(requestId)) throw new Error("Invalid request id");
  const temporary = inside({
    base: store.requestAttachmentsDirectory,
    leaf: `.attachments-${requestId}-${randomBytes(6).toString("hex")}`,
  });
  const destination = inside({
    base: store.requestAttachmentsDirectory,
    leaf: requestId,
  });
  await mkdir(temporary, { recursive: true, mode: DIRECTORY_MODE });
  try {
    const attachments: Array<ReviewImageAttachment> = [];
    for (const reference of references) {
      const stored = await readReviewImage({ store, id: reference.id });
      if (stored === undefined)
        throw new Error(`Unknown or corrupt review image ${reference.id}`);
      const format = sniffReviewImage(stored.bytes);
      if (format === undefined)
        throw new Error(`Unknown or corrupt review image ${reference.id}`);
      const filename = `image-${reference.id}.${format.extension}`;
      await writeFile(
        inside({ base: temporary, leaf: filename }),
        stored.bytes,
        { mode: FILE_MODE },
      );
      attachments.push({
        ...stored.descriptor,
        alt: reference.alt,
        sha256: stored.descriptor.id,
        path: inside({ base: destination, leaf: filename }),
      });
    }
    await rename(temporary, destination);
    return attachments;
  } catch (error: unknown) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
};

/**
 * How many times a caller retries a lock another process holds before giving
 * up. Every retry waits `LOCK_WAIT_MS`, so this is what bounds how long a
 * caller is willing to wait for the lock.
 */
const LOCK_ATTEMPTS = 200;
const LOCK_WAIT_MS = 10;
const LOCK_OWNER_FILE = "owner.json";
const LOCK_CLEANUP_PREFIX = ".cleanup-";

type StoreLockOwner = {
  readonly pid: number;
  readonly token: string;
};

const processIsRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !hasCode(error, "ESRCH");
  }
};

const waitForLock = async (): Promise<void> => {
  await new Promise<void>((settle) => {
    setTimeout(settle, LOCK_WAIT_MS);
  });
};

const lockOwner = (value: unknown): StoreLockOwner | undefined => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("pid" in value) ||
    typeof value.pid !== "number" ||
    !Number.isInteger(value.pid) ||
    !("token" in value) ||
    typeof value.token !== "string"
  ) {
    return undefined;
  }
  return { pid: value.pid, token: value.token };
};

const cleanupPid = (name: string): number | undefined => {
  const match = /^\.cleanup-(\d+)-[a-f0-9]+\.json$/.exec(name);
  if (match === null) return undefined;
  const pid = Number(match[1]);
  return Number.isInteger(pid) ? pid : undefined;
};

const retireLockDirectory = async ({
  lockPath,
  label,
}: {
  readonly lockPath: string;
  readonly label: string;
}): Promise<boolean> => {
  const retiredPath = `${lockPath}.${label}.${process.pid}.${randomBytes(8).toString("hex")}`;
  try {
    await rename(lockPath, retiredPath);
  } catch (error: unknown) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
  await rm(retiredPath, { recursive: true, force: true });
  return true;
};

/** Removes an abandoned generation without touching its replacement. */
const clearAbandonedLock = async (lockPath: string): Promise<void> => {
  const ownerPath = join(lockPath, LOCK_OWNER_FILE);
  let owner: StoreLockOwner | undefined;
  let ownerExists = true;
  try {
    const serialized = await readFile(ownerPath, "utf8");
    try {
      owner = lockOwner(JSON.parse(serialized));
    } catch {
      owner = undefined;
    }
  } catch (error: unknown) {
    if (!hasCode(error, "ENOENT")) throw error;
    ownerExists = false;
  }
  if (!ownerExists) {
    let entries: ReadonlyArray<string>;
    try {
      entries = await readdir(lockPath);
    } catch (error: unknown) {
      if (hasCode(error, "ENOENT")) return;
      throw error;
    }
    if (
      entries.some((entry) => {
        const pid = cleanupPid(entry);
        return pid !== undefined && processIsRunning(pid);
      })
    ) {
      return;
    }
    owner = { pid: process.pid, token: randomBytes(16).toString("hex") };
    try {
      await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, {
        flag: "wx",
        mode: FILE_MODE,
      });
    } catch (error: unknown) {
      if (hasCode(error, "EEXIST") || hasCode(error, "ENOENT")) return;
      throw error;
    }
    await retireLockDirectory({ lockPath, label: "abandoned" });
    return;
  }
  if (owner !== undefined && processIsRunning(owner.pid)) {
    return;
  }
  const claimPath = join(
    lockPath,
    `${LOCK_CLEANUP_PREFIX}${process.pid}-${randomBytes(8).toString("hex")}.json`,
  );
  try {
    await rename(ownerPath, claimPath);
  } catch (error: unknown) {
    if (hasCode(error, "ENOENT")) return;
    throw error;
  }
  await retireLockDirectory({ lockPath, label: "abandoned" });
};

/** Creates one fully initialized lock generation before publishing it. */
const acquireStoreLock = async (
  lockPath: string,
  invalidLockError: () => Error,
): Promise<StoreLockOwner | undefined> => {
  try {
    const generation = await lstat(lockPath);
    if (generation.isSymbolicLink() || !generation.isDirectory()) {
      throw invalidLockError();
    }
  } catch (error: unknown) {
    if (!hasCode(error, "ENOENT")) throw error;
  }
  const owner = { pid: process.pid, token: randomBytes(16).toString("hex") };
  const candidatePath = `${lockPath}.candidate.${process.pid}.${owner.token}`;
  try {
    await mkdir(candidatePath, { mode: DIRECTORY_MODE });
    await writeFile(
      join(candidatePath, LOCK_OWNER_FILE),
      `${JSON.stringify(owner)}\n`,
      { flag: "wx", mode: FILE_MODE },
    );
    await rename(candidatePath, lockPath);
    return owner;
  } catch (error: unknown) {
    await rm(candidatePath, { recursive: true, force: true });
    if (hasCode(error, "EEXIST") || hasCode(error, "ENOTEMPTY")) {
      const generation = await lstat(lockPath).catch((cause: unknown) => {
        if (hasCode(cause, "ENOENT")) return undefined;
        throw cause;
      });
      if (
        generation !== undefined &&
        (generation.isSymbolicLink() || !generation.isDirectory())
      ) {
        throw invalidLockError();
      }
      await clearAbandonedLock(lockPath);
      return undefined;
    }
    throw error;
  }
};

/**
 * Retires the generation this call published, and never fails. The change it
 * guarded has already finished by the time this runs, so a generation that
 * another process retired, an unreadable owner file, and a filesystem failure
 * are all recovered here instead of surfacing as a caller-visible error over
 * work that already succeeded.
 */
const releaseStoreLock = async ({
  lockPath,
  owner,
}: {
  readonly lockPath: string;
  readonly owner: StoreLockOwner;
}): Promise<void> => {
  let current: StoreLockOwner | undefined;
  try {
    current = lockOwner(
      JSON.parse(await readFile(join(lockPath, LOCK_OWNER_FILE), "utf8")),
    );
  } catch {
    // A retired or unreadable generation is no longer ours to retire.
    return;
  }
  if (
    current === undefined ||
    current.pid !== owner.pid ||
    current.token !== owner.token
  ) {
    // Some other generation holds this path now. Retiring it would take a
    // live lock away from the process that published it.
    return;
  }
  try {
    await retireLockDirectory({ lockPath, label: "released" });
  } catch {
    // A generation this process cannot retire is cleared by the next
    // acquire once this process is gone.
  }
};

/**
 * Names the resource a timed-out wait was waiting for. The caller owns what
 * the failure means, so its own error and type are kept and only the contended
 * lock and the time spent on it are added; without them, every lock in the
 * store reports the same sentence and a wedged session names nothing.
 */
const withContendedLock = ({
  error,
  lockPath,
  waitedMs,
}: {
  readonly error: Error;
  readonly lockPath: string;
  readonly waitedMs: number;
}): Error => {
  // The lock's own name identifies the resource; the directory holding it is
  // an implementation detail this message must not put in front of a reviewer.
  error.message = `${error.message} (waited ${waitedMs}ms for ${basename(lockPath)})`;
  return error;
};

/**
 * Runs one store change while other processes wait for the same resource.
 *
 * `lockAttempts` bounds how long this call is willing to wait for a lock
 * someone else holds, in retries of `LOCK_WAIT_MS` each. It is worth naming
 * because the answer belongs to the caller: a write whose failure is survivable
 * can decide the wait is not worth what it costs, while every ordinary caller
 * keeps the store-wide budget.
 */
export const withReviewStoreLock = async <TResult>({
  lockPath,
  change,
  timeoutError,
  invalidLockError = () => new Error("The review store lock is unavailable"),
  lockAttempts = LOCK_ATTEMPTS,
}: {
  readonly lockPath: string;
  readonly change: () => Promise<TResult>;
  readonly timeoutError: () => Error;
  readonly invalidLockError?: () => Error;
  readonly lockAttempts?: number;
}): Promise<TResult> => {
  const startedAtMs = Date.now();
  for (let attempt = 0; attempt < lockAttempts; attempt += 1) {
    const owner = await acquireStoreLock(lockPath, invalidLockError);
    if (owner === undefined) {
      await waitForLock();
      continue;
    }
    try {
      return await change();
    } finally {
      // Releasing never throws, so it can neither fail a completed change
      // nor replace the error a failed change is already raising.
      await releaseStoreLock({ lockPath, owner });
    }
  }
  throw withContendedLock({
    error: timeoutError(),
    lockPath,
    waitedMs: Date.now() - startedAtMs,
  });
};

/** How much persistent state one review session currently retains. */
export type ReviewStoreGrowth = {
  readonly progressLines: number;
  readonly agentRequests: number;
  readonly agentResponses: number;
};

const publishedJsonFileNames = async (
  directory: string,
): Promise<ReadonlyArray<string>> =>
  (await readdir(directory).catch(() => []))
    .filter((name) => PUBLISHED_JSON_FILE.test(name))
    .sort();

/**
 * Counts persistent review state for long-session diagnostics. The progress
 * log is compacted, while agent exchange files continue to accumulate, so a
 * suspected long-session stall needs the current retained sizes as numbers,
 * not as a hypothesis.
 */
export const reviewStoreGrowth = async ({
  store,
}: {
  readonly store: ReviewStore;
}): Promise<ReviewStoreGrowth> => {
  // Counted through the same cache the read paths use, so asking how much of
  // the log remains does not itself re-read it every minute.
  const progressLines = (await readProgressValues(store.progressPath)).length;
  const [agentRequests, agentResponses] = await Promise.all([
    publishedJsonFileNames(store.agentRequestDirectory).then(
      (names) => names.length,
    ),
    publishedJsonFileNames(store.agentResponseDirectory).then(
      (names) => names.length,
    ),
  ]);
  return { progressLines, agentRequests, agentResponses };
};

/** Replaces one file's whole contents without ever showing a partial one. */
const writeFileAtomically = async ({
  path,
  contents,
}: {
  readonly path: string;
  readonly contents: string;
}): Promise<void> => {
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporaryPath, contents, { flag: "wx", mode: FILE_MODE });
    await chmod(temporaryPath, FILE_MODE);
    await rename(temporaryPath, path);
  } catch (error: unknown) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
};

/**
 * Replaces one JSON file without ever showing a partial one. Exported because
 * the atomic file primitives are this module's to own, and the staged plan
 * mutation writes its manifest and journal through them.
 */
export const writeStoreJson = async ({
  path,
  value,
}: {
  readonly path: string;
  readonly value: unknown;
}): Promise<void> =>
  writeFileAtomically({
    path,
    contents: `${JSON.stringify(value, null, 2)}\n`,
  });

/** Reads a stored comment list back through the caller's own validator. */
export const readComments = async ({
  path,
  validate,
}: {
  readonly path: string;
  readonly validate: (value: unknown) => ReadonlyArray<ReviewComment>;
}): Promise<ReadonlyArray<ReviewComment>> => {
  const stored = await readStoreJson(path);
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
  await writeStoreJson({ path, value: comments });
};

/**
 * One read of the staged decision answers. An unreadable record is reported
 * rather than swallowed: falling back to an empty one is total answer loss, and
 * the next accepted write overwrites the evidence, so the caller that owns
 * operational output gets the chance to say so.
 */
export type StagedInputsRead = {
  readonly inputs: StagedInputs;
  readonly unreadable?: string;
};

// Absent and unreadable are the same empty record but not the same event, so
// this store reads its own file rather than through the shared helper, which
// answers undefined for both.
const readInputsText = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch (error: unknown) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
};

/** Reads staged decision answers back through their owned validator. */
export const readStagedInputs = async ({
  store,
  validate,
}: {
  readonly store: ReviewStore;
  readonly validate: (value: unknown) => StagedInputs;
}): Promise<StagedInputsRead> => {
  const stored = await readInputsText(store.inputsPath);
  if (stored === undefined) return { inputs: validate(undefined) };
  try {
    return { inputs: validate(JSON.parse(stored)) };
  } catch (error: unknown) {
    return {
      inputs: validate(undefined),
      unreadable: error instanceof Error ? error.message : String(error),
    };
  }
};

/** Atomically replaces the staged decision-answer record. */
export const writeStagedInputs = async ({
  store,
  inputs,
}: {
  readonly store: ReviewStore;
  readonly inputs: StagedInputs;
}): Promise<void> => {
  await writeStoreJson({ path: store.inputsPath, value: inputs });
};

/**
 * Reads recorded change dispositions back through their owned validator. A
 * record this build cannot read is answered as empty rather than thrown,
 * because an unreadable disposition record reopens change sets the reviewer
 * has to look at again - a visible, recoverable loss, unlike a lost answer.
 */
export const readChangeDispositions = async ({
  store,
  validate,
}: {
  readonly store: ReviewStore;
  readonly validate: (value: unknown) => StoredChangeDispositions;
}): Promise<StoredChangeDispositions> => {
  const stored = await readStoreJson(store.changeDispositionsPath);
  try {
    return validate(stored);
  } catch {
    return validate(undefined);
  }
};

/** Atomically replaces the recorded change dispositions. */
export const writeChangeDispositions = async ({
  store,
  dispositions,
}: {
  readonly store: ReviewStore;
  readonly dispositions: StoredChangeDispositions;
}): Promise<void> => {
  await writeStoreJson({
    path: store.changeDispositionsPath,
    value: dispositions,
  });
};

const snapshotPath = ({
  store,
  snapshot,
}: {
  readonly store: ReviewStore;
  readonly snapshot: string;
}): string => {
  if (!/^[a-f0-9]{16,64}$/.test(snapshot)) {
    throw new Error("A source snapshot must be a hexadecimal digest");
  }
  return inside({
    base: store.snapshotDirectory,
    leaf: `${snapshot}.mdx`,
  });
};

/** Retains authoritative source the first time its snapshot is observed. */
export const writeSnapshot = async ({
  store,
  snapshot,
  source,
}: {
  readonly store: ReviewStore;
  readonly snapshot: string;
  readonly source: string;
}): Promise<void> => {
  const path = snapshotPath({ store, snapshot });
  try {
    await readFile(path, "utf8");
  } catch {
    await writeFile(path, source, { mode: FILE_MODE, flag: "wx" }).catch(
      async (error: unknown) => {
        // Two request paths may observe the same digest concurrently. A file
        // that now exists is the same immutable snapshot, not a conflict.
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
export const readSnapshot = async ({
  store,
  snapshot,
}: {
  readonly store: ReviewStore;
  readonly snapshot: string;
}): Promise<string> => readFile(snapshotPath({ store, snapshot }), "utf8");

/** Reads the durable set of locally resolved thread ids. */
export const readResolvedCommentIds = async ({
  store,
  validate,
}: {
  readonly store: ReviewStore;
  readonly validate: (value: unknown) => ReadonlyArray<string>;
}): Promise<ReadonlyArray<string>> => {
  const value = await readStoreJson(store.resolvedPath);
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
  await writeStoreJson({ path: store.resolvedPath, value: ids });
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
  await writeStoreJson({ path: jsonPath, value: feedback });
  await writeFile(briefPath, brief, { mode: FILE_MODE });
  await chmod(briefPath, FILE_MODE);
  return { jsonPath, briefPath };
};

const feedbackSubmissionPath = ({
  store,
  submissionId,
}: {
  readonly store: ReviewStore;
  readonly submissionId: string;
}): string => {
  if (!/^[a-f0-9]{16}$/.test(submissionId)) {
    throw new Error("A feedback submission id must be hexadecimal");
  }
  return inside({
    base: store.feedbackSubmissionDirectory,
    leaf: `${submissionId}.json`,
  });
};

export const readFeedbackSubmissionValue = async ({
  store,
  submissionId,
}: {
  readonly store: ReviewStore;
  readonly submissionId: string;
}): Promise<unknown> =>
  readStoreJson(feedbackSubmissionPath({ store, submissionId }));

export const writeFeedbackSubmissionValue = async ({
  store,
  submissionId,
  value,
}: {
  readonly store: ReviewStore;
  readonly submissionId: string;
  readonly value: unknown;
}): Promise<void> => {
  await writeStoreJson({
    path: feedbackSubmissionPath({ store, submissionId }),
    value,
  });
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
  const names = await publishedJsonFileNames(directory);
  const values: Array<unknown> = [];
  for (const name of names) {
    const value = await readStoreJson(inside({ base: directory, leaf: name }));
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
  await writeStoreJson({
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
  readStoreJson(
    exchangePath({ directory: store.agentRequestDirectory, requestId }),
  );

/**
 * Which requests have a response on disk, from the directory listing alone.
 * Deciding what to read must not cost what reading it would.
 */
export const listAgentResponseRequestIds = async (
  store: ReviewStore,
): Promise<ReadonlyArray<string>> =>
  (await publishedJsonFileNames(store.agentResponseDirectory)).map((name) =>
    name.slice(0, -".json".length),
  );

/** Reads the named untrusted response values for validation by the exchange. */
export const readAgentResponseValuesFor = async ({
  store,
  requestIds,
}: {
  readonly store: ReviewStore;
  readonly requestIds: ReadonlyArray<string>;
}): Promise<ReadonlyArray<unknown>> => {
  const values: Array<unknown> = [];
  for (const requestId of requestIds) {
    const value = await readStoreJson(
      exchangePath({ directory: store.agentResponseDirectory, requestId }),
    );
    if (value !== undefined) values.push(value);
  }
  return values;
};

/** Reads one untrusted response value for a locked mailbox change. */
export const readAgentResponseValue = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<unknown> =>
  readStoreJson(
    exchangePath({ directory: store.agentResponseDirectory, requestId }),
  );

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
  await writeStoreJson({
    path: exchangePath({
      directory: store.agentRequestDirectory,
      requestId,
    }),
    value,
  });
};

export type AgentRequestDeletionResult =
  | { readonly attachmentCleanup: "complete" }
  | {
      readonly attachmentCleanup: "failed";
      readonly cleanupError: unknown;
    };

/** Where one request's prepared commit journal lives, if it has one. */
export const agentMutationJournalPath = ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): string => {
  if (!/^[a-f0-9]{16}$/.test(requestId)) {
    throw new Error(
      "An agent exchange request id must be 16 hexadecimal characters",
    );
  }
  return inside({
    base: store.agentMutationJournalDirectory,
    leaf: `${requestId}.json`,
  });
};

/**
 * Whether a commit for this request has already written its journal. A commit
 * that got that far has published, or is one rename away from publishing, so
 * this is what tells the reviewer's controls the answer is no longer theirs to
 * withdraw.
 */
export const hasPreparedMutationJournal = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<boolean> =>
  stat(agentMutationJournalPath({ store, requestId })).then(
    () => true,
    () => false,
  );

/**
 * The highest claim generation this request has a stage directory for, or 0
 * when it has none.
 *
 * A claim generation names a stage, so a number handed out twice would let a
 * new claim resume a stage an earlier one left behind. What is on disk is the
 * only record of a generation that survived its claim's release, so a new
 * claim is seeded above this rather than above the request alone.
 */
export const highestAgentMutationStageGeneration = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<number> => {
  if (!/^[a-f0-9]{16}$/.test(requestId)) {
    throw new Error(
      "An agent exchange request id must be 16 hexadecimal characters",
    );
  }
  // Only a missing directory means this request has no stage. Every other read
  // failure hides generations that do exist, and answering 0 for one of those
  // hands back a generation whose stage is still on disk - the reuse this
  // function exists to prevent. A takeover that cannot read the stages fails
  // loudly instead of fencing on a number it could not check.
  const names = await readdir(
    inside({ base: store.agentMutationDirectory, leaf: requestId }),
  ).catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return [];
    throw error;
  });
  return names.reduce(
    (highest, name) =>
      /^[0-9]{1,9}$/.test(name) ? Math.max(highest, Number(name)) : highest,
    0,
  );
};

/**
 * Removes every claim stage one request owns, with the private plan candidate
 * each of them holds. A request that can no longer produce an answer - it
 * committed, or the reviewer withdrew it - keeps none of them.
 */
export const removeAgentMutationStages = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<void> => {
  if (!/^[a-f0-9]{16}$/.test(requestId)) {
    throw new Error(
      "An agent exchange request id must be 16 hexadecimal characters",
    );
  }
  await rm(inside({ base: store.agentMutationDirectory, leaf: requestId }), {
    recursive: true,
    force: true,
  });
};

/**
 * Removes one request the agent never started, together with the blobs frozen
 * for it. The request file goes first, so a failed blob cleanup leaves orphaned
 * bytes rather than a message the reviewer believes they deleted.
 */
export const deleteAgentRequestValue = async ({
  store,
  requestId,
}: {
  readonly store: ReviewStore;
  readonly requestId: string;
}): Promise<AgentRequestDeletionResult> => {
  const anchoredStore = await anchorReviewStore(store);
  const requestDirectory = await anchoredStore.resolveDirectoryPath({
    directory: "agentRequestDirectory",
  });
  await rm(exchangePath({ directory: requestDirectory.path, requestId }), {
    force: true,
  });
  try {
    const attachmentDirectory = await anchoredStore.resolveDirectoryPath({
      directory: "requestAttachmentsDirectory",
      requestId,
      allowMissingRequestDirectory: true,
    });
    if (attachmentDirectory.exists) {
      await rm(attachmentDirectory.path, { recursive: true, force: true });
    }
    return { attachmentCleanup: "complete" };
  } catch (cleanupError: unknown) {
    return { attachmentCleanup: "failed", cleanupError };
  }
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
  await writeStoreJson({
    path: exchangePath({
      directory: store.agentResponseDirectory,
      requestId,
    }),
    value,
  });
};

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
): Promise<unknown> => readStoreJson(store.sessionPath);

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
  const compacted = [...readableProgressHistories(values).values()]
    .flatMap((history) => history.entries.slice(-PROGRESS_EVENT_LIMIT))
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.event);
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

/** Writes one checked session value for the authority module. */
export const writeSessionDescriptorValue = async ({
  store,
  value,
}: {
  readonly store: ReviewStore;
  readonly value: unknown;
}): Promise<void> => {
  await writeStoreJson({ path: store.sessionPath, value });
};

/** Reads the untrusted session heartbeat for the authority module. */
export const readSessionHeartbeatValue = async (
  store: ReviewStore,
): Promise<unknown> => readStoreJson(store.heartbeatPath);

/** Writes one checked session heartbeat for the authority module. */
export const writeSessionHeartbeatValue = async ({
  store,
  value,
}: {
  readonly store: ReviewStore;
  readonly value: unknown;
}): Promise<void> => {
  await writeStoreJson({ path: store.heartbeatPath, value });
};

export type AgentPresence = {
  readonly connected: boolean;
  readonly state: "waiting" | "working";
  readonly requestId?: string;
  readonly updatedAtMs?: number;
  /**
   * When the loop that wrote this heartbeat observed its own session ending.
   * Its presence is the whole difference between a silence Big Plan is still
   * inferring from and an end it was told about.
   */
  readonly endedAtMs?: number;
};

/**
 * The heartbeat lock stayed held for the whole waiting budget, so this write
 * never ran. Both heartbeat writers answer it by reporting the write they did
 * not make: the liveness signal repeats, and neither of its writers may end
 * the session it is describing just because it lost a race for the file.
 */
class AgentHeartbeatLockContended extends Error {
  constructor() {
    super("Another process is writing the agent heartbeat");
    this.name = "AgentHeartbeatLockContended";
  }
}

/** Runs one agent heartbeat write, reporting contention instead of raising it. */
const withAgentHeartbeatLock = async ({
  store,
  change,
  lockAttempts,
}: {
  readonly store: ReviewStore;
  readonly change: () => Promise<boolean>;
  readonly lockAttempts?: number;
}): Promise<boolean> => {
  try {
    return await withReviewStoreLock({
      lockPath: store.agentHeartbeatLockPath,
      change,
      timeoutError: () => new AgentHeartbeatLockContended(),
      lockAttempts,
    });
  } catch (error: unknown) {
    if (error instanceof AgentHeartbeatLockContended) return false;
    throw error;
  }
};

/** The writer the stored heartbeat currently names, if it names one. */
const storedHeartbeatWriterId = async (
  store: ReviewStore,
): Promise<string | undefined> => {
  const value = await readStoreJson(store.agentHeartbeatPath);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("writerId" in value) ||
    typeof value.writerId !== "string"
  ) {
    return undefined;
  }
  return value.writerId;
};

/**
 * Refreshes the coding-agent liveness signal with its observable state.
 *
 * `writerId` identifies the invocation doing the writing, because the session
 * id is shared by every agent process attached to this review and so cannot
 * tell two of them apart. Passing one claims the signal for this invocation.
 * Omitting one keeps whichever writer the heartbeat already names, so a
 * process that only reports progress cannot take the connection loop's
 * identity away from it and leave a session with no one able to report its
 * end. Reading that name is part of the write and not a step before it: a
 * newer loop may claim the signal at any moment, and the two would otherwise
 * race the same way the end marker's guard already refuses to.
 *
 * `lockAttempts` bounds the wait for the heartbeat lock.
 *
 * Returns whether the signal was refreshed. Contention is reported rather than
 * raised because this runs every half second inside the connection loop's own
 * wait: the next refresh answers a lost race, while an exception there would
 * end the session this signal exists to vouch for.
 */
export const writeAgentHeartbeat = async ({
  store,
  sessionId,
  state,
  requestId,
  writerId,
  now = Date.now(),
  lockAttempts,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly state: "waiting" | "working";
  readonly requestId?: string;
  readonly writerId?: string;
  readonly now?: number;
  readonly lockAttempts?: number;
}): Promise<boolean> =>
  withAgentHeartbeatLock({
    store,
    lockAttempts,
    change: async () => {
      const writer = writerId ?? (await storedHeartbeatWriterId(store));
      await writeStoreJson({
        path: store.agentHeartbeatPath,
        value: {
          sessionId,
          state,
          ...(requestId === undefined ? {} : { requestId }),
          ...(writer === undefined ? {} : { writerId: writer }),
          updatedAtMs: now,
        },
      });
      return true;
    },
  });

/**
 * Records that this loop observed its own session end, and refuses to speak
 * for any other.
 *
 * The guard is the point: by the time a loop can write this, a newer agent may
 * already own the heartbeat, and marking that live session ended would be a
 * worse lie than the stale connection this marker exists to remove. Every
 * other field is carried through untouched, so whatever the live heartbeat
 * says about the agent's identity keeps saying it after the session ends.
 *
 * The lock is what makes that guard worth stating: reading the writer and
 * overwriting it are one step against every other heartbeat writer, so a newer
 * loop's first heartbeat cannot land inside the comparison and be marked
 * ended by the loop it replaced.
 *
 * Returns whether the marker was written. A refusal, including a contended
 * lock, leaves the unchanged aging window to report the silence instead.
 */
export const writeAgentHeartbeatEnded = async ({
  store,
  sessionId,
  writerId,
  now = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly writerId: string;
  readonly now?: number;
}): Promise<boolean> =>
  withAgentHeartbeatLock({
    store,
    change: async () => {
      const value = await readStoreJson(store.agentHeartbeatPath);
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        !("sessionId" in value) ||
        value.sessionId !== sessionId ||
        !("writerId" in value) ||
        value.writerId !== writerId
      ) {
        return false;
      }
      await writeStoreJson({
        path: store.agentHeartbeatPath,
        value: {
          ...(value as Readonly<Record<string, unknown>>),
          state: "ended",
          updatedAtMs: now,
          endedAtMs: now,
        },
      });
      return true;
    },
  });

/** Reads the coding-agent presence signal without turning stale data into work. */
export const readAgentPresence = async ({
  store,
  sessionId,
  now = Date.now(),
  maximumAgeMs = AGENT_STALL_MS,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly now?: number;
  readonly maximumAgeMs?: number;
}): Promise<AgentPresence> => {
  const value = await readStoreJson(store.agentHeartbeatPath);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("sessionId" in value) ||
    value.sessionId !== sessionId ||
    !("state" in value) ||
    (value.state !== "waiting" &&
      value.state !== "working" &&
      value.state !== "ended") ||
    !("updatedAtMs" in value) ||
    typeof value.updatedAtMs !== "number" ||
    !Number.isFinite(value.updatedAtMs) ||
    now - value.updatedAtMs < 0
  ) {
    return { connected: false, state: "waiting" };
  }
  // An end the loop observed needs no aging: the question aging answers has
  // already been answered, by the only process that could answer it.
  if (value.state === "ended") {
    return {
      connected: false,
      state: "waiting",
      updatedAtMs: value.updatedAtMs,
      endedAtMs:
        "endedAtMs" in value &&
        typeof value.endedAtMs === "number" &&
        Number.isFinite(value.endedAtMs)
          ? value.endedAtMs
          : value.updatedAtMs,
    };
  }
  if (now - value.updatedAtMs > maximumAgeMs) {
    return {
      connected: false,
      state: "waiting",
      updatedAtMs: value.updatedAtMs,
    };
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
