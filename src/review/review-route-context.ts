// The contract every extracted review route speaks: the runtime state a handler
// may read, and the response value it returns instead of writing to the socket
// itself. Keeping the response a value is what lets the runtime decide, after
// the handler has run, whether this session still holds write authority.
//
// The owned objects here were loose `let` bindings inside the runtime closure,
// mutated from places far apart in one very long function. Each is named after
// the thing it means, because that is the state whose drift breaks a review
// silently rather than loudly.

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { renderDocument } from "../render/render-document.js";
import type { BlockMapEntry, ReviewComment } from "./shared/comment.js";
import {
  validateCommentUpdates,
  validateResolvedCommentIds,
  validateStoredComments,
} from "./shared/comment.js";
import { deriveSnapshotDigest, readAgentExchange } from "./agent-exchange.js";
import {
  readApprovalRecord,
  readChangeVerdicts,
  readComments,
  readResolvedCommentIds,
  readStagedInputs,
  writeApprovalRecord,
  writeChangeVerdicts,
  writeStagedInputs,
} from "./store.js";
import type { ReviewStore } from "./store.js";
import {
  deriveDecisionInventory,
  type DecisionInventory,
} from "./decision-inventory.js";
import { validateStagedInputs } from "./plan-inputs-store.js";
import type { StagedInputs } from "./plan-inputs-store.js";
import { validateChangeVerdicts } from "./change-verdicts-store.js";
import type { StoredChangeVerdicts } from "./change-verdicts-store.js";
import { validateApprovalRecord } from "./approval-record.js";
import type { ApprovalRecord } from "./shared/approval.js";
import {
  MUTATION_STALL_MS,
  ReviewWriteStalled,
  stalledMutations,
} from "./runtime-watchdog.js";
import type { MutationRegistry } from "./runtime-watchdog.js";
import { reviewStateVersion } from "./review-state-version.js";
import {
  encodeAgentRequests,
  encodeReviewSnapshot,
} from "./shared/review-wire.js";
import type { SnapshotDiff } from "./shared/review-wire.js";
import { createRevisionedRecord } from "./revisioned-record.js";

/**
 * A response a route decided on. The runtime owns how it reaches the socket,
 * including the headers each kind carries.
 */
export type ReviewRouteResponse =
  | { readonly kind: "json"; readonly status: number; readonly value: unknown }
  | {
      readonly kind: "binary";
      readonly status: number;
      readonly contentType: string;
      readonly body: Uint8Array;
    };

/** Everything a route learns about the request that reached it. */
export type ReviewRouteRequest = {
  readonly query: URLSearchParams;
  readonly headers: Readonly<
    Record<string, string | Array<string> | undefined>
  >;
  readonly body?: unknown;
  readonly binaryBody?: Uint8Array;
};

/**
 * Reads a mutating request body as a record without trusting its shape. Every
 * field is still validated by the route; this only says the body was an object.
 */
export const payloadOf = (body: unknown): Readonly<Record<string, unknown>> =>
  typeof body === "object" && body !== null
    ? (body as Readonly<Record<string, unknown>>)
    : {};

export type ReviewRouteHandler = (
  context: ReviewRouteContext,
  request: ReviewRouteRequest,
) => Promise<ReviewRouteResponse>;

/**
 * A path probe: a pathname-addressed asset route that answers with a response
 * when the pathname is its own, and with `undefined` when it is not.
 */
export type ReviewAssetHandler = (
  context: ReviewRouteContext,
  request: { readonly pathname: string },
) => Promise<ReviewRouteResponse | undefined>;

export const jsonResponse = ({
  status,
  value,
}: {
  readonly status: number;
  readonly value: unknown;
}): ReviewRouteResponse => ({ kind: "json", status, value });

/**
 * A refusal is an ordinary JSON response; only the body shape is fixed. A
 * refusal the browser must act on differently from the rest of its status
 * class also carries a code, because two refusals can share a status.
 */
export const refusal = ({
  status,
  reason,
  code,
}: {
  readonly status: number;
  readonly reason: string;
  readonly code?: string;
}): ReviewRouteResponse => ({
  kind: "json",
  status,
  value: code === undefined ? { error: reason } : { error: reason, code },
});

export const binaryResponse = ({
  status,
  contentType,
  body,
}: {
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
}): ReviewRouteResponse => ({ kind: "binary", status, contentType, body });

/**
 * Renders the plan and answers the comment questions that only make sense
 * against the current render, caching the block map until the source changes.
 */
export type PlanRenderer = {
  readonly renderPlan: () => Promise<string>;
  readonly readStoredComments: (
    path: string,
  ) => Promise<ReadonlyArray<ReviewComment>>;
  readonly validateUpdates: (
    value: unknown,
    readStore?: ReviewStore,
  ) => Promise<ReadonlyArray<ReviewComment>>;
};

/** The snapshot the browser may reload onto, and the responses behind it. */
export type ReaderProgress = {
  readonly currentSnapshot: () => string;
  readonly hasObserved: (requestId: string) => boolean;
  readonly observe: (response: {
    readonly requestId: string;
    readonly resultSnapshot: string;
  }) => void;
  readonly accept: (snapshot: string) => void;
};

/** Serializes whole mutations so overlapping requests cannot lose a write. */
export type WriteGate = {
  readonly exclusively: <T>(input: {
    readonly route: string;
    readonly work: () => Promise<T>;
  }) => Promise<T>;
  /**
   * How long the oldest mutation past its bound has been running, or
   * `undefined` while every write is inside it. This is the session's own
   * answer to "are changes still being accepted", and it stays answered while
   * the abandoned work is still out there.
   */
  readonly stalledForMs: () => number | undefined;
};

/**
 * The decisions the plan currently asks, and the stored answers read against
 * them. The inventory is what makes the runtime, rather than the browser, the
 * party that decides which answers are still current, so it is cached by the
 * digest of the source the document was rendered from and can never describe a
 * plan the reader was not served.
 */
export type DecisionAnswers = {
  readonly inventory: () => Promise<DecisionInventory>;
  readonly read: () => Promise<StagedInputs>;
  readonly write: (inputs: StagedInputs) => Promise<void>;
};

/**
 * The change verdicts this review has recorded. Unlike the answer record
 * there is no inventory to join against: a verdict names the two snapshot
 * digests it closed, so it already refers to exactly one revision's content.
 */
export type ChangeVerdicts = {
  readonly read: () => Promise<StoredChangeVerdicts>;
  readonly write: (verdicts: StoredChangeVerdicts) => Promise<void>;
};

/**
 * Compiled diff payloads keyed only by the immutable content digests that
 * produced them. Reviewer disposition is deliberately absent: it is served
 * beside this payload through its own route and cannot invalidate a compile.
 */
export type SnapshotDiffs = {
  readonly forPair: (input: {
    readonly from: string;
    readonly to: string;
    readonly build: () => SnapshotDiff | Promise<SnapshotDiff>;
  }) => Promise<SnapshotDiff>;
};

/** The append-only approval log this review has recorded. */
export type Approvals = {
  readonly read: () => Promise<ApprovalRecord>;
  readonly write: (record: ApprovalRecord) => Promise<void>;
};

/** The review's one lifetime policy and its current activity. */
export type ActivityClock = {
  readonly idleTimeoutMs: number;
  readonly touch: () => void;
  readonly idleForMs: () => number;
  readonly expiresAtMs: () => number | undefined;
};

export type ReviewRouteContext = {
  readonly store: ReviewStore;
  readonly planId: string;
  readonly sessionId: string;
  readonly resolvedPlanPath: string;
  readonly agentCommand: string;
  readonly restartCommand: string;
  readonly recoveryPrompt: string;
  readonly planRenderer: PlanRenderer;
  readonly decisionAnswers: DecisionAnswers;
  readonly changeVerdicts: ChangeVerdicts;
  readonly snapshotDiffs: SnapshotDiffs;
  readonly approvals: Approvals;
  readonly readerProgress: ReaderProgress;
  readonly writeGate: WriteGate;
  readonly activityClock: ActivityClock;
  readonly reportDiagnostic: (diagnostic: {
    readonly message: string;
    readonly error: unknown;
  }) => void;
};

const SNAPSHOT_DIFF_CACHE_MAX_ENTRIES = 8;
const SNAPSHOT_DIFF_CACHE_MAX_AGE_MS = 30 * 60 * 1_000;

type SnapshotDiffCacheEntry = {
  readonly value: Promise<SnapshotDiff>;
  lastUsedAtMs: number;
};

/**
 * Owns the runtime-local compiled diff cache. Reusing the in-flight promise
 * also keeps overlapping opens from compiling the same immutable pair twice.
 */
export const createSnapshotDiffs = ({
  maxEntries = SNAPSHOT_DIFF_CACHE_MAX_ENTRIES,
  maxAgeMs = SNAPSHOT_DIFF_CACHE_MAX_AGE_MS,
  now = Date.now,
}: {
  readonly maxEntries?: number;
  readonly maxAgeMs?: number;
  readonly now?: () => number;
} = {}): SnapshotDiffs => {
  const entries = new Map<string, SnapshotDiffCacheEntry>();

  const evictExpired = (nowMs: number): void => {
    for (const [key, entry] of entries) {
      if (nowMs - entry.lastUsedAtMs >= maxAgeMs) entries.delete(key);
    }
  };

  const evictOldest = (): void => {
    let oldestKey: string | undefined;
    let oldestAtMs = Number.POSITIVE_INFINITY;
    for (const [key, entry] of entries) {
      if (entry.lastUsedAtMs < oldestAtMs) {
        oldestKey = key;
        oldestAtMs = entry.lastUsedAtMs;
      }
    }
    if (oldestKey !== undefined) entries.delete(oldestKey);
  };

  return {
    forPair: ({ from, to, build }) => {
      const nowMs = now();
      evictExpired(nowMs);
      const key = `${from}:${to}`;
      const cached = entries.get(key);
      if (cached !== undefined) {
        cached.lastUsedAtMs = nowMs;
        return cached.value;
      }
      while (entries.size >= maxEntries) evictOldest();
      const value = Promise.resolve().then(build);
      entries.set(key, { value, lastUsedAtMs: nowMs });
      void value.catch(() => {
        if (entries.get(key)?.value === value) entries.delete(key);
      });
      return value;
    },
  };
};

export const createPlanRenderer = ({
  store,
  planId,
  sessionId,
  token,
  resolvedPlanPath,
  initialSnapshot,
  isDiffPreview,
}: {
  readonly store: ReviewStore;
  readonly planId: string;
  readonly sessionId: string;
  readonly token: string;
  readonly resolvedPlanPath: string;
  readonly initialSnapshot: string;
  readonly isDiffPreview: boolean;
}): PlanRenderer => {
  // The current render map authorizes newly created targets. Stored comments
  // carry their already-validated target metadata across later revisions.
  const blocks = new Map<string, BlockMapEntry>();
  let blockMapMarkdown: string | undefined;

  const validateStored = (value: unknown): ReadonlyArray<ReviewComment> =>
    validateStoredComments({
      value,
      now: new Date().toISOString(),
      fallbackPremiseSnapshot: initialSnapshot,
    });

  const readStoredComments = (
    path: string,
  ): Promise<ReadonlyArray<ReviewComment>> =>
    readComments({ path, validate: validateStored });

  /**
   * Validates one batch of reviewer comments against what is already stored.
   *
   * The store is a parameter rather than the captured one because a route
   * anchors the store per request: reading the existing comments through the
   * store this renderer was built with would take those reads outside the
   * anchored chain a symlinked review directory is checked against.
   */
  const validateUpdates = async (
    value: unknown,
    readStore: ReviewStore = store,
  ): Promise<ReadonlyArray<ReviewComment>> =>
    validateCommentUpdates({
      value,
      blocks,
      existing: [
        ...(await readStoredComments(readStore.draftsPath)),
        ...(await readStoredComments(readStore.sentPath)),
      ],
      now: new Date().toISOString(),
    });

  const readBootstrap = async (markdown: string): Promise<string> => {
    const drafts = await readStoredComments(store.draftsPath);
    const resolvedCommentIds = await readResolvedCommentIds({
      store,
      validate: validateResolvedCommentIds,
    });
    const agent = await readAgentExchange({ store, sessionId, planId });
    return JSON.stringify({
      ...encodeReviewSnapshot({
        drafts,
        sent: await readStoredComments(store.sentPath),
        resolvedCommentIds,
        version: reviewStateVersion({ drafts, resolvedCommentIds }),
      }),
      agent: { ...agent, requests: encodeAgentRequests(agent.requests) },
      currentSnapshot: deriveSnapshotDigest(markdown),
      diffPreview: isDiffPreview,
    });
  };

  const renderPlan = async (): Promise<string> => {
    const markdown = await readFile(resolvedPlanPath, "utf8");
    if (blockMapMarkdown !== markdown) {
      const blockMapRender = renderDocument({
        markdown,
        fallbackTitle: basename(resolvedPlanPath, extname(resolvedPlanPath)),
        identity: { planId, reviewSessionId: sessionId, reviewToken: token },
      });
      blocks.clear();
      for (const block of blockMapRender.blocks) {
        blocks.set(block.id, block);
      }
      blockMapMarkdown = markdown;
    }
    return renderDocument({
      markdown,
      fallbackTitle: basename(resolvedPlanPath, extname(resolvedPlanPath)),
      identity: {
        planId,
        reviewSessionId: sessionId,
        reviewToken: token,
        reviewBootstrap: await readBootstrap(markdown),
      },
    }).html;
  };

  return { renderPlan, readStoredComments, validateUpdates };
};

/**
 * Owns the compiled decision inventory and every read and write of the answer
 * record.
 *
 * The inventory is recompiled only when the plan source changes, keyed by the
 * same digest the rest of the runtime identifies a revision by. A record that
 * cannot be read is total answer loss, so it is reported once per runtime
 * rather than silently answered as empty: repeating it on every later read
 * would be noise, and the next accepted write replaces the evidence anyway.
 *
 * The revision a browser has applied is its guard against stale responses, so
 * within one runtime the revision this object answers with never decreases:
 * a record that resets underneath the session - unreadable and answered as
 * empty, or replaced out of band - is served at the highest revision already
 * handed out, and the next accepted write advances from there.
 */
export const createDecisionAnswers = ({
  store,
  resolvedPlanPath,
  reportDiagnostic,
}: {
  readonly store: ReviewStore;
  readonly resolvedPlanPath: string;
  readonly reportDiagnostic: ReviewRouteContext["reportDiagnostic"];
}): DecisionAnswers => {
  let inventoryDigest: string | undefined;
  let inventory: DecisionInventory = new Map();
  let reportedUnreadable = false;
  const record = createRevisionedRecord<StagedInputs>({
    initial: { version: 1, revision: 0, answers: [] },
    readStored: async () => {
      const { inputs, unreadable } = await readStagedInputs({
        store,
        validate: validateStagedInputs,
      });
      if (unreadable !== undefined && !reportedUnreadable) {
        reportedUnreadable = true;
        reportDiagnostic({
          message:
            "Stored decision answers could not be read and were treated as empty",
          error: new Error(unreadable),
        });
      }
      return inputs;
    },
    writeStored: (inputs) => writeStagedInputs({ store, inputs }),
  });
  return {
    inventory: async () => {
      const markdown = await readFile(resolvedPlanPath, "utf8");
      const digest = deriveSnapshotDigest(markdown);
      if (inventoryDigest !== digest) {
        inventory = deriveDecisionInventory({
          markdown,
          fallbackTitle: basename(resolvedPlanPath, extname(resolvedPlanPath)),
        });
        inventoryDigest = digest;
      }
      return inventory;
    },
    read: record.read,
    write: record.write,
  };
};

/**
 * Owns every read and write of the change-verdict record.
 *
 * The revision a browser has applied is its guard against stale responses, so
 * within one runtime the revision this object answers with never decreases:
 * a record that resets underneath the session - unreadable and answered as
 * empty, or replaced out of band - is served at the highest revision already
 * handed out, and the next accepted write advances from there.
 */
export const createChangeVerdicts = ({
  store,
}: {
  readonly store: ReviewStore;
}): ChangeVerdicts => {
  return createRevisionedRecord<StoredChangeVerdicts>({
    initial: { version: 1, revision: 0, accepted: [] },
    readStored: () =>
      readChangeVerdicts({
        store,
        validate: validateChangeVerdicts,
      }),
    writeStored: (verdicts) => writeChangeVerdicts({ store, verdicts }),
  });
};

/**
 * Owns every read and write of the approval log. Unlike the answer and
 * verdict records there is no revision token: the log is append-only, the
 * derived status is computed against the current source digest, and a stale
 * write is refused by the digest compare-and-swap on approve rather than by
 * a count.
 */
export const createApprovals = ({
  store,
  reportDiagnostic,
}: {
  readonly store: ReviewStore;
  readonly reportDiagnostic: ReviewRouteContext["reportDiagnostic"];
}): Approvals => {
  let reportedUnreadable = false;
  return {
    read: async () => {
      const { record, unreadable } = await readApprovalRecord({
        store,
        validate: validateApprovalRecord,
      });
      if (unreadable !== undefined && !reportedUnreadable) {
        reportedUnreadable = true;
        reportDiagnostic({
          message:
            "Stored approval log could not be read and was treated as empty",
          error: new Error(unreadable),
        });
      }
      return record;
    },
    write: (record) => writeApprovalRecord({ store, record }),
  };
};

/**
 * Tracks the revision the reader has been shown. Only a response the runtime
 * has not seen before moves it: the browser reloads revisions the response
 * command has already rendered, linted, and accepted, so re-reading the
 * exchange must never drag the reader back onto an older result.
 */
export const createReaderProgress = ({
  initialSnapshot,
  observedResponseIds,
}: {
  readonly initialSnapshot: string;
  readonly observedResponseIds: ReadonlyArray<string>;
}): ReaderProgress => {
  const observed = new Set(observedResponseIds);
  let acceptedSnapshot = initialSnapshot;
  return {
    currentSnapshot: () => acceptedSnapshot,
    // The polled exchange route asks this before it reads a revision body, so
    // a log that only ever grows costs one directory listing per poll.
    hasObserved: (requestId) => observed.has(requestId),
    observe: (response) => {
      if (!observed.has(response.requestId)) {
        acceptedSnapshot = response.resultSnapshot;
      }
      observed.add(response.requestId);
    },
    accept: (snapshot) => {
      acceptedSnapshot = snapshot;
    },
  };
};

/**
 * Mutating requests share filesystem-backed state. Keep each full mutation
 * atomic so overlapping browser requests cannot lose one another's writes.
 *
 * The gate is bounded, because an unbounded one is what made BIG-44 fatal: a
 * single mutation that never settled disabled every later write for the life
 * of the process while reads kept answering, so the session looked healthy and
 * was not. Past its bound the gate stops waiting for that mutation, refuses it
 * so its own request gets an answer, and hands the gate to the next one.
 */
export const createWriteGate = ({
  mutations,
  stallMs = MUTATION_STALL_MS,
}: {
  readonly mutations: MutationRegistry;
  readonly stallMs?: number;
}): WriteGate => {
  let gate: Promise<unknown> = Promise.resolve();
  return {
    exclusively: <T>({
      route,
      work,
    }: {
      readonly route: string;
      readonly work: () => Promise<T>;
    }): Promise<T> => {
      // Register only when the gate hands this request its turn. Time spent
      // waiting behind another mutation is not time spent doing its own work.
      const run = async (): Promise<T> => {
        const settled = mutations.begin({ route, atMs: Date.now() });
        // Abandoning a mutation does not stop it. It stays registered until it
        // really settles, which is what keeps the session reporting itself as
        // degraded, and nothing is left to read its result or its failure.
        const running = work().finally(settled);
        running.catch(() => undefined);
        let bound: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            running,
            new Promise<never>((_, giveUp) => {
              bound = setTimeout(
                () =>
                  giveUp(new ReviewWriteStalled({ route, boundMs: stallMs })),
                stallMs,
              );
            }),
          ]);
        } finally {
          if (bound !== undefined) clearTimeout(bound);
        }
      };
      const next = gate.then(run, run);
      gate = next.catch(() => undefined);
      return next;
    },
    stalledForMs: () =>
      stalledMutations({
        inFlight: mutations.inFlight(),
        nowMs: Date.now(),
        boundMs: stallMs,
      })[0]?.ageMs,
  };
};

export const createActivityClock = (
  idleTimeoutMs: number,
  now: () => number = Date.now,
): ActivityClock => {
  let lastActivityAt = now();
  return {
    idleTimeoutMs,
    touch: () => {
      lastActivityAt = now();
    },
    idleForMs: () => now() - lastActivityAt,
    expiresAtMs: () =>
      idleTimeoutMs > 0 ? lastActivityAt + idleTimeoutMs : undefined,
  };
};
