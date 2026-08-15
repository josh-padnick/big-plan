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
  validateActiveDraft,
  validateCommentUpdates,
  validateResolvedCommentIds,
  validateStoredComments,
} from "./shared/comment.js";
import { deriveSnapshotDigest, readAgentExchange } from "./agent-exchange.js";
import {
  readActiveDraft,
  readComments,
  readResolvedCommentIds,
} from "./store.js";
import type { ReviewStore } from "./store.js";
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
  readonly exclusively: <T>(work: () => Promise<T>) => Promise<T>;
};

/** How long the review has gone without reviewer activity. */
export type ActivityClock = {
  readonly touch: () => void;
  readonly idleForMs: () => number;
};

export type ReviewRouteContext = {
  readonly store: ReviewStore;
  readonly planId: string;
  readonly sessionId: string;
  readonly resolvedPlanPath: string;
  readonly agentCommand: string;
  readonly recoveryPrompt: string;
  readonly planRenderer: PlanRenderer;
  readonly readerProgress: ReaderProgress;
  readonly writeGate: WriteGate;
  readonly activityClock: ActivityClock;
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
        activeDraft: await readActiveDraft({
          path: store.activeDraftPath,
          validate: validateActiveDraft,
        }),
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
 */
export const createWriteGate = (): WriteGate => {
  let gate: Promise<unknown> = Promise.resolve();
  return {
    exclusively: <T>(work: () => Promise<T>): Promise<T> => {
      const next = gate.then(work, work);
      gate = next.catch(() => undefined);
      return next;
    },
  };
};

export const createActivityClock = (): ActivityClock => {
  let lastActivityAt = Date.now();
  return {
    touch: () => {
      lastActivityAt = Date.now();
    },
    idleForMs: () => Date.now() - lastActivityAt,
  };
};
