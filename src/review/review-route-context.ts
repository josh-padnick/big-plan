// The contract every extracted review route speaks: the runtime state a handler
// may read, and the response value it returns instead of writing to the socket
// itself. Keeping the response a value is what lets the runtime decide, after
// the handler has run, whether this session still holds write authority.
//
// The four owned objects here were loose `let` bindings inside the runtime
// closure, mutated from places far apart in one very long function. Each is
// named after the thing it means, because that is the state whose drift breaks
// a review silently rather than loudly.

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
import { readComments, readResolvedCommentIds } from "./store.js";
import type { ReviewStore } from "./store.js";
import {
  MUTATION_STALL_MS,
  ReviewWriteStalled,
  stalledMutations,
} from "./runtime-watchdog.js";
import type { MutationRegistry } from "./runtime-watchdog.js";
import { encodeReviewSnapshot } from "./shared/review-wire.js";

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

/** A refusal is an ordinary JSON response; only the body shape is fixed. */
export const refusal = ({
  status,
  reason,
}: {
  readonly status: number;
  readonly reason: string;
}): ReviewRouteResponse => ({
  kind: "json",
  status,
  value: { error: reason },
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
  ) => Promise<ReadonlyArray<ReviewComment>>;
};

/** The snapshot the browser may reload onto, and the responses behind it. */
export type ReaderProgress = {
  readonly currentSnapshot: () => string;
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
  readonly readerProgress: ReaderProgress;
  readonly writeGate: WriteGate;
  readonly activityClock: ActivityClock;
  readonly reportDiagnostic: (diagnostic: {
    readonly message: string;
    readonly error: unknown;
  }) => void;
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

  const validateUpdates = async (
    value: unknown,
  ): Promise<ReadonlyArray<ReviewComment>> =>
    validateCommentUpdates({
      value,
      blocks,
      existing: [
        ...(await readStoredComments(store.draftsPath)),
        ...(await readStoredComments(store.sentPath)),
      ],
      now: new Date().toISOString(),
    });

  const readBootstrap = async (markdown: string): Promise<string> =>
    JSON.stringify({
      ...encodeReviewSnapshot({
        drafts: await readStoredComments(store.draftsPath),
        sent: await readStoredComments(store.sentPath),
        resolvedCommentIds: await readResolvedCommentIds({
          store,
          validate: validateResolvedCommentIds,
        }),
      }),
      agent: await readAgentExchange({ store, sessionId, planId }),
      currentSnapshot: deriveSnapshotDigest(markdown),
      diffPreview: isDiffPreview,
    });

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

export const createActivityClock = (idleTimeoutMs: number): ActivityClock => {
  let lastActivityAt = Date.now();
  return {
    idleTimeoutMs,
    touch: () => {
      lastActivityAt = Date.now();
    },
    idleForMs: () => Date.now() - lastActivityAt,
    expiresAtMs: () =>
      idleTimeoutMs > 0 ? lastActivityAt + idleTimeoutMs : undefined,
  };
};
