// The local review runtime: the loopback server that renders and serves the
// plan, persists review state, and mediates the reviewer-agent exchange.
//
// Loopback is not an authentication boundary. Any page the reviewer visits can
// reach 127.0.0.1, and any process running as the reviewer can too, so every
// request is authorised on its own merits here rather than trusted because of
// where it arrived from:
//
//  - Bound explicitly to 127.0.0.1 on an ephemeral port. Never 0.0.0.0, never
//    a hostname.
//  - A per-session token, minted at start and injected into the one document
//    this runtime serves, is required on every API request and travels in a
//    header so it stays out of history, referrers, and logs.
//  - Any request whose Host header is not this runtime's own address is
//    refused. That, not the address check, is what defeats DNS rebinding.
//  - No CORS allowance is ever sent, and a foreign Origin or a Sec-Fetch-Site
//    other than same-origin is refused outright. CORS hides a response; it
//    does not stop a write, so it is not the control here.
//  - A fixed route-and-method allow-list. There is no general static file route
//    and no directory listing. The plan-picture route serves only supported
//    picture file types. The requested path and the real path must stay inside
//    the plan directory, and neither path can contain a dot-prefixed segment.
//    The opened file must match the accepted path, must be a regular file, and
//    must stay inside the image size limit.
//  - One local filesystem limit is accepted. Node does not provide a file-open
//    operation relative to an already-open directory handle. An attacker who
//    can write in the reviewer's plan directory can replace an ancestor
//    directory between path validation and file open. The attacker can then
//    make the plan-picture route open a file outside the plan directory. This
//    limit is accepted because the attacker already has access to the
//    reviewer's local files, and this server listens only on loopback.
//  - The document is always rendered in-process from the authoritative MDX. A
//    pre-existing .html is never served, because arbitrary HTML is arbitrary
//    script running on this runtime's own origin.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { basename, extname, resolve } from "node:path";
import {
  renderDocument,
  MarkdownDiagnosticsError,
} from "../render/render-document.js";
import type { ReviewComment } from "./shared/comment.js";
import {
  CommentRejected,
  validateResolvedCommentIds,
  validateStoredComments,
} from "./shared/comment.js";
import { buildFeedbackPackage } from "./feedback-package.js";
import {
  deriveSnapshotDigest,
  feedbackAgentRequest,
  messageAgentRequest,
  readAgentExchange,
  readValidatedAgentRequests,
  requestBlocksPlanPickup,
  requestIsTerminal,
  validateAgentResponseDraft,
  writeAgentRequest,
} from "./agent-exchange.js";
import {
  claimAgentRequest,
  commitRequestTerminal,
  recordAgentConnectionState,
} from "./request-mailbox.js";
import {
  deriveReviewPlanId,
  prepareStore,
  randomId,
  readAgentPresence,
  readComments,
  readResolvedCommentIds,
  reviewStoreFor,
  reviewStoreGrowth,
  writeComments,
  writeSnapshot,
} from "./store.js";
import type { ReviewStore, ReviewStoreGrowth } from "./store.js";
import {
  createMutationRegistry,
  describeRuntimeFailure,
  describeStalledMutation,
  growthMilestone,
  MUTATION_STALL_MS,
  ReviewWriteStalled,
  stalledMutations,
} from "./runtime-watchdog.js";
import type { ReviewRuntimeDiagnostics } from "./runtime-watchdog.js";
import { RAW_IMAGE_BODY_LIMIT } from "./shared/review-image.js";
import { reviewIdleDurationLabel } from "./shared/review-lifetime.js";
import { buildSnapshotDiff } from "./snapshot-diff.js";
import {
  agentConnectCommand,
  agentRecoveryPrompt,
  reviewRestartCommand,
} from "./shared/agent-command.js";
import { AGENT_CLAIM_LEASE_MS } from "./shared/agent-claim.js";
import {
  activateReviewSession,
  liveReviewCustody,
  ReviewCustodyHeld,
  REVIEW_HEARTBEAT_INTERVAL_MS,
  readCurrentReviewSession,
  refreshReviewSessionHeartbeat,
  stopReviewSessionIfInactive,
  withReviewSessionAuthority,
} from "./session-authority.js";
import type { ReviewSessionDescriptor } from "./session-authority.js";
import {
  createActivityClock,
  createPlanRenderer,
  createReaderProgress,
  createWriteGate,
} from "./review-route-context.js";
import type {
  ReviewAssetHandler,
  ReviewRouteContext,
  ReviewRouteHandler,
  ReviewRouteResponse,
} from "./review-route-context.js";
import {
  planAssetResponse,
  publishImage,
  reviewImageResponse,
} from "./routes-assets.js";
import {
  cancelPendingAgentRequest,
  deleteQueuedAgentRequest,
  readAgentSnapshot,
  readProgressEvents,
  sendAgentRequest,
} from "./routes-agent-exchange.js";
import { readSnapshotDiff } from "./routes-diff.js";
import {
  deleteSentComment,
  readReviewState,
  revertAgentChanges,
  submitFeedback,
  updateReviewState,
} from "./routes-review-state.js";
import { readRuntimeSession } from "./routes-session.js";

const TOKEN_HEADER = "x-big-plan-review-token";
const BODY_LIMIT_BYTES = 1024 * 1024;
const SHUTDOWN_GRACE_MS = 100;
const STALL_CHECK_INTERVAL_MS = 5_000;
const GROWTH_CHECK_INTERVAL_MS = 60_000;
// Persistent review state is reported on a ladder rather than every minute, so
// operators can correlate a long-session stall with the retained state size
// without filling the terminal with repetitive diagnostics.
const GROWTH_MILESTONE = 1_000;
// Everything the document needs is embedded, and the only origin it may reach
// is this runtime. The browser enforces the egress boundary the design claims.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src data:",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

const ASSET_CONTENT_SECURITY_POLICY = "default-src 'none'; sandbox";

type Route = {
  readonly method: "GET" | "PUT" | "POST";
  readonly path: string;
};

// Every entry names its own handler, so the allow-list and the dispatch table
// are the same list and cannot drift: a route with no handler is a compile
// error here rather than a 500 the first time a reviewer asks for it.
type ApiRoute = Route & {
  readonly binary?: boolean;
  readonly handler: ReviewRouteHandler;
};

const DOCUMENT_ROUTE: Route = { method: "GET", path: "/" };

// The whole surface. A request that does not match one of these pairs exactly
// is refused before anything else looks at it.
const API_ROUTES: ReadonlyArray<ApiRoute> = [
  { method: "GET", path: "/api/session", handler: readRuntimeSession },
  { method: "GET", path: "/api/drafts", handler: readReviewState },
  { method: "PUT", path: "/api/drafts", handler: updateReviewState },
  { method: "POST", path: "/api/feedback", handler: submitFeedback },
  { method: "POST", path: "/api/comments-delete", handler: deleteSentComment },
  {
    method: "POST",
    path: "/api/revert-agent-changes",
    handler: revertAgentChanges,
  },
  { method: "GET", path: "/api/agent", handler: readAgentSnapshot },
  { method: "POST", path: "/api/agent-requests", handler: sendAgentRequest },
  {
    method: "POST",
    path: "/api/agent-request-delete",
    handler: deleteQueuedAgentRequest,
  },
  {
    method: "POST",
    path: "/api/agent-cancel",
    handler: cancelPendingAgentRequest,
  },
  { method: "GET", path: "/api/progress", handler: readProgressEvents },
  { method: "GET", path: "/api/snapshot-diff", handler: readSnapshotDiff },
  {
    method: "POST",
    path: "/api/review-images",
    binary: true,
    handler: publishImage,
  },
];

// The pathname-addressed asset routes, tried in order after the document
// route. Each answers with `undefined` when the pathname is not its own.
const ASSET_HANDLERS: ReadonlyArray<ReviewAssetHandler> = [
  planAssetResponse,
  reviewImageResponse,
];

/** A running review runtime. */
export type ReviewRuntime = {
  readonly url: string;
  readonly port: number;
  readonly sessionId: string;
  readonly planId: string;
  readonly planPath: string;
  readonly store: ReviewStore;
  /** The live session this runtime replaced, when `takeover` displaced one. */
  readonly replacedSession?: ReviewSessionDescriptor;
  readonly close: (reason?: string) => Promise<void>;
  /** Reports what this runtime is doing right now, including any stalled write. */
  readonly diagnostics: () => ReviewRuntimeDiagnostics;
  readonly diagnosticGrowth: () => Promise<ReviewStoreGrowth | undefined>;
};

const constantTimeEquals = (left: string, right: string): boolean => {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  // Length is not secret, and timingSafeEqual requires equal lengths.
  return a.length === b.length && timingSafeEqual(a, b);
};

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Array<Buffer> = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT_BYTES) {
      throw new CommentRejected("The request body is too large");
    }
    chunks.push(buffer);
  }
  if (size === 0) {
    return undefined;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new CommentRejected("The request body is not valid JSON");
  }
};

/** Streams one raw image body while enforcing its route-specific cap. */
const readBinaryBody = async (
  request: IncomingMessage,
): Promise<Uint8Array> => {
  const chunks: Array<Buffer> = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > RAW_IMAGE_BODY_LIMIT) {
      throw new CommentRejected("The image body is too large");
    }
    chunks.push(buffer);
  }
  return Uint8Array.from(Buffer.concat(chunks));
};

const send = ({
  response,
  status,
  contentType,
  body,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}): void => {
  response.writeHead(status, {
    "content-type": contentType,
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  });
  response.end(body);
};

const sendJson = ({
  response,
  status,
  value,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly value: unknown;
}): void =>
  send({
    response,
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(value),
  });

const sendBinary = ({
  response,
  status,
  contentType,
  body,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly contentType: string;
  readonly body: Uint8Array;
}): void => {
  response.writeHead(status, {
    "content-type": contentType,
    "content-security-policy": ASSET_CONTENT_SECURITY_POLICY,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  });
  response.end(body);
};

const refuse = ({
  response,
  status,
  reason,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly reason: string;
}): void => sendJson({ response, status, value: { error: reason } });

/**
 * How long a review outlives its last sign of life. Every authenticated
 * request from an open page counts, so this measures genuine abandonment -
 * nobody reading and no agent working - rather than time since the last
 * keystroke. Callers override it with `--idle-timeout`; zero disables it.
 */
export const DEFAULT_REVIEW_IDLE_TIMEOUT_MS = 30 * 60 * 1_000;

/**
 * Initializes the durable review state this session has just taken custody of.
 *
 * Every write here lands in the plan's shared store, so it runs only after the
 * locked activation: a runtime that lost a start-up tie, or one that was
 * refused because another runtime is live, must leave that store exactly as it
 * found it.
 */
const initializeOwnedReviewState = async ({
  store,
  planId,
  sessionId,
  resolvedPlanPath,
  initialSource,
  initialSnapshot,
  diffPreviewSource,
}: {
  readonly store: ReviewStore;
  readonly planId: string;
  readonly sessionId: string;
  readonly resolvedPlanPath: string;
  readonly initialSource: string;
  readonly initialSnapshot: string;
  readonly diffPreviewSource?: string;
}): Promise<Awaited<ReturnType<typeof readAgentExchange>>> => {
  await writeSnapshot({
    store,
    snapshot: initialSnapshot,
    source: initialSource,
  });
  const storedComments = (path: string) =>
    readComments({
      path,
      validate: (value) =>
        validateStoredComments({
          value,
          now: new Date().toISOString(),
          fallbackPremiseSnapshot: initialSnapshot,
        }),
    });
  const [storedDrafts, storedSent, storedResolved, storedExchange] =
    await Promise.all([
      storedComments(store.draftsPath),
      storedComments(store.sentPath),
      readResolvedCommentIds({ store, validate: validateResolvedCommentIds }),
      readAgentExchange({ store, sessionId, planId }),
    ]);
  const reviewAlreadyStarted =
    storedDrafts.length > 0 ||
    storedSent.length > 0 ||
    storedResolved.length > 0 ||
    storedExchange.requests.length > 0 ||
    storedExchange.responses.length > 0;
  if (diffPreviewSource !== undefined && !reviewAlreadyStarted) {
    const premiseSnapshot = deriveSnapshotDigest(diffPreviewSource);
    await writeSnapshot({
      store,
      snapshot: premiseSnapshot,
      source: diffPreviewSource,
    });
    const fallbackTitle = basename(resolvedPlanPath, extname(resolvedPlanPath));
    const before = renderDocument({
      markdown: diffPreviewSource,
      fallbackTitle,
      identity: {},
    });
    const after = renderDocument({
      markdown: initialSource,
      fallbackTitle,
      identity: {},
    });
    const previewDiff = buildSnapshotDiff({
      from: premiseSnapshot,
      to: initialSnapshot,
      before: before.blocks,
      after: after.blocks,
    });
    const changeTargets = [
      ...new Set(
        previewDiff.locations.flatMap((location) =>
          location.newBlockId === undefined
            ? location.oldBlockId === undefined
              ? []
              : [location.oldBlockId]
            : [location.newBlockId],
        ),
      ),
    ];
    const previewBlock = after.blocks.find((block) =>
      changeTargets.includes(block.id),
    );
    const createdAt = new Date().toISOString();
    const previewComment: ReviewComment = {
      id: randomId(8),
      body: "Make every causal change reviewable in place.",
      createdAt,
      premiseSnapshot,
      target:
        previewBlock === undefined
          ? { type: "document" }
          : {
              type: "block",
              blockId: previewBlock.id,
              kind: previewBlock.kind,
              label: previewBlock.label,
              ...(previewBlock.section === undefined
                ? {}
                : { section: previewBlock.section }),
            },
    };
    const feedback = buildFeedbackPackage({
      sessionId,
      packageId: randomId(8),
      planId,
      planPath: resolvedPlanPath,
      createdAt,
      comments: [previewComment],
    });
    const feedbackRequest = feedbackAgentRequest({
      feedback,
      premiseSnapshot,
    });
    await writeComments({ path: store.sentPath, comments: [previewComment] });
    await writeAgentRequest({ store, request: feedbackRequest });
    const claimedFeedbackRequest = await claimAgentRequest({
      store,
      activeSessionId: sessionId,
      requestId: feedbackRequest.requestId,
      claimedBy: sessionId,
      baselineSnapshot: premiseSnapshot,
      now: createdAt,
    });
    await commitRequestTerminal({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: feedbackRequest.requestId,
          outcomes: [
            changeTargets.length === 0
              ? {
                  commentId: previewComment.id,
                  state: "answered",
                  message:
                    "The preview source matches the plan, so there is no causal change to show yet.",
                }
              : {
                  commentId: previewComment.id,
                  state: "changed",
                  message:
                    "The answer now carries its own causal Was/Now evidence.",
                  changeTargets,
                },
          ],
        },
        request: claimedFeedbackRequest,
        commentsById: new Map([[previewComment.id, previewComment]]),
        changedBlocks: new Set(changeTargets),
        currentSnapshot: initialSnapshot,
        now: createdAt,
      }),
      claimedBy: sessionId,
      now: createdAt,
    });
    const historicalSource = `${diffPreviewSource.trimEnd()}\n\n## Retired experiment\n\nThis temporary policy is removed by the next revision.\n`;
    const historicalSnapshot = deriveSnapshotDigest(historicalSource);
    await writeSnapshot({
      store,
      snapshot: historicalSnapshot,
      source: historicalSource,
    });
    const historicalRequest = messageAgentRequest({
      kind: "chat",
      requestId: randomId(8),
      sessionId,
      planId,
      premiseSnapshot,
      createdAt: new Date(Date.parse(createdAt) + 1).toISOString(),
      body: "Add the temporary policy for review.",
    });
    await writeAgentRequest({ store, request: historicalRequest });
    const claimedHistoricalRequest = await claimAgentRequest({
      store,
      activeSessionId: sessionId,
      requestId: historicalRequest.requestId,
      claimedBy: sessionId,
      baselineSnapshot: premiseSnapshot,
      now: new Date(Date.parse(createdAt) + 1).toISOString(),
    });
    await commitRequestTerminal({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: historicalRequest.requestId,
          message:
            "I added the temporary policy, which a later revision removed.",
        },
        request: claimedHistoricalRequest,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: historicalSnapshot,
        now: new Date(Date.parse(createdAt) + 1).toISOString(),
      }),
      claimedBy: sessionId,
      now: new Date(Date.parse(createdAt) + 1).toISOString(),
    });
    const chatRequest = messageAgentRequest({
      kind: "chat",
      requestId: randomId(8),
      sessionId,
      planId,
      premiseSnapshot,
      createdAt: new Date(Date.parse(createdAt) + 2).toISOString(),
      body: "Show the causal diff gallery.",
    });
    await writeAgentRequest({ store, request: chatRequest });
    const claimedChatRequest = await claimAgentRequest({
      store,
      activeSessionId: sessionId,
      requestId: chatRequest.requestId,
      claimedBy: sessionId,
      baselineSnapshot: premiseSnapshot,
      now: new Date(Date.parse(createdAt) + 2).toISOString(),
    });
    await commitRequestTerminal({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: chatRequest.requestId,
          message:
            "I updated the gallery so every changed place can be reviewed.",
        },
        request: claimedChatRequest,
        commentsById: new Map(),
        changedBlocks: new Set(),
        currentSnapshot: initialSnapshot,
        now: new Date(Date.parse(createdAt) + 2).toISOString(),
      }),
      claimedBy: sessionId,
      now: new Date(Date.parse(createdAt) + 2).toISOString(),
    });
    if (previewBlock !== undefined) {
      await writeComments({
        path: store.draftsPath,
        comments: [
          {
            ...previewComment,
            id: randomId(8),
            body: "Check this comment against its older premise.",
          },
        ],
      });
    }
  }

  return readAgentExchange({ store, sessionId, planId });
};

/**
 * Closes a bound server without waiting on its connections: idle ones are
 * dropped at once and the rest are forced shut after the shutdown grace, so a
 * request arriving at the wrong moment cannot keep close() from settling.
 */
const drainAndCloseServer = async (server: Server): Promise<void> => {
  const closedServer = new Promise<void>((settle) => {
    server.close(() => settle());
  });
  server.closeIdleConnections();
  const forceClose = setTimeout(() => {
    server.closeAllConnections();
  }, SHUTDOWN_GRACE_MS);
  forceClose.unref();
  try {
    await closedServer;
  } finally {
    clearTimeout(forceClose);
  }
};

/**
 * Starts the review runtime for one plan and resolves once it is listening.
 * The caller owns the plan path; nothing about a request ever contributes one.
 */
export const startReviewRuntime = async ({
  planPath,
  diffPreviewSource,
  idleTimeoutMs = DEFAULT_REVIEW_IDLE_TIMEOUT_MS,
  writeStallMs = MUTATION_STALL_MS,
  queuedWorkIdleTimeoutMs = AGENT_CLAIM_LEASE_MS,
  takeover = false,
}: {
  readonly planPath: string;
  readonly diffPreviewSource?: string;
  readonly idleTimeoutMs?: number;
  /** How long one mutation may run before this runtime gives up on it. */
  readonly writeStallMs?: number;
  readonly queuedWorkIdleTimeoutMs?: number;
  /** Replaces a live runtime that still holds this plan, instead of yielding. */
  readonly takeover?: boolean;
}): Promise<ReviewRuntime> => {
  const queuedWorkIdleLimitMs = Number.isFinite(queuedWorkIdleTimeoutMs)
    ? Math.max(0, Math.min(AGENT_CLAIM_LEASE_MS, queuedWorkIdleTimeoutMs))
    : AGENT_CLAIM_LEASE_MS;
  const resolvedPlanPath = resolve(planPath);
  const executablePath = resolve(process.argv[1] ?? "bin/big-plan.mjs");
  const agentCommand = agentConnectCommand({
    executablePath,
    planPath: resolvedPlanPath,
  });
  const restartCommand = reviewRestartCommand({
    executablePath,
    planPath: resolvedPlanPath,
  });
  const recoveryPrompt = agentRecoveryPrompt({
    executablePath,
    planPath: resolvedPlanPath,
  });
  const planId = deriveReviewPlanId({ planPath: resolvedPlanPath });
  const sessionId = randomId(8);
  const store = reviewStoreFor({ planPath: resolvedPlanPath, planId });
  await prepareStore(store);
  // Yield before binding a port or rendering anything. This is the fast answer
  // for the common case; it cannot settle a tie, which is what the locked
  // activation below is for.
  const liveAtStart = await liveReviewCustody({
    store,
    planId,
    plan: resolvedPlanPath,
  });
  if (liveAtStart !== undefined && !takeover) {
    throw new ReviewCustodyHeld(liveAtStart);
  }
  const previousSession = await readCurrentReviewSession({ store });
  // The token protects API requests that write the durable image store or use
  // the live mailbox. Keep it stable when a later runtime takes custody of the
  // same plan; the session id, not the token, identifies write authority.
  const token = previousSession?.token ?? randomBytes(32).toString("base64url");
  const initialSource = await readFile(resolvedPlanPath, "utf8");
  renderDocument({
    markdown: initialSource,
    fallbackTitle: basename(resolvedPlanPath, extname(resolvedPlanPath)),
    identity: {},
  });
  const initialSnapshot = deriveSnapshotDigest(initialSource);

  // Custody is taken before this runtime writes anything the plan's owner can
  // see. The descriptor carries the address, so the socket has to be bound
  // first; it is bound without a request listener and starts serving only once
  // initialization below has finished.
  const server: Server = createServer();
  await new Promise<void>((settle, fail) => {
    server.once("error", fail);
    server.listen({ host: "127.0.0.1", port: 0 }, settle);
  });
  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  const url = `http://127.0.0.1:${port}/`;

  // The early check cannot settle a tie: two runtimes may both have passed it
  // before either wrote a descriptor. This one runs inside the custody lock, so
  // exactly one of them wins and the other gives its port back having written
  // nothing.
  const activation = await activateReviewSession({
    store,
    takeover,
    descriptor: {
      version: 1,
      sessionId,
      planId,
      plan: resolvedPlanPath,
      url,
      port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      // The token is here so the reviewer's own tools can reach the runtime;
      // the file is owner-only, which is what keeps that safe.
      token,
    },
  }).catch(async (error: unknown): Promise<never> => {
    // The socket is already bound. Leaving without closing it strands the port
    // for the life of the process, whether custody failed or was refused.
    await drainAndCloseServer(server);
    throw error;
  });
  if (!activation.activated) {
    await drainAndCloseServer(server);
    throw new ReviewCustodyHeld(activation.live);
  }

  let heartbeatWrite = Promise.resolve();
  let heartbeatFailureReported = false;
  const queueHeartbeat = (
    running: boolean,
    stopReason?: string,
  ): Promise<void> => {
    heartbeatWrite = heartbeatWrite
      .catch(() => undefined)
      .then(async () => {
        await refreshReviewSessionHeartbeat({
          store,
          sessionId,
          running,
          ...(stopReason === undefined ? {} : { stopReason }),
        });
      })
      .catch((error: unknown) => {
        if (heartbeatFailureReported) return;
        heartbeatFailureReported = true;
        process.stderr.write(
          `Review heartbeat failed for session ${sessionId} (${resolvedPlanPath}): ${String(error)}\n`,
        );
      });
    return heartbeatWrite;
  };
  // The heartbeat starts, and keeps renewing, before any owned-state work so
  // liveness rests on the heartbeat itself rather than on the descriptor's
  // start-up grace, however long initialization takes. Heartbeats touch only
  // this session's own liveness record, never the plan's shared review state.
  await queueHeartbeat(true);
  const heartbeatTimer = setInterval(() => {
    void queueHeartbeat(true);
  }, REVIEW_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  // Everything below mutates state this session now owns. A failure gives the
  // port back rather than leaving a bound socket behind, and records a stopped
  // heartbeat so custody is released immediately instead of after the grace
  // window.
  const initialExchange = await initializeOwnedReviewState({
    store,
    planId,
    sessionId,
    resolvedPlanPath,
    initialSource,
    initialSnapshot,
    ...(diffPreviewSource === undefined ? {} : { diffPreviewSource }),
  }).catch(async (error: unknown) => {
    clearInterval(heartbeatTimer);
    await queueHeartbeat(
      false,
      "The review runtime failed while starting and never served this plan.",
    );
    await drainAndCloseServer(server);
    throw error;
  });
  const mutations = createMutationRegistry();

  // Every piece of state the routes share is built once, here, and named after
  // what it means. Anything a route may read travels through this record.
  const context: ReviewRouteContext = {
    store,
    planId,
    sessionId,
    resolvedPlanPath,
    agentCommand,
    restartCommand,
    recoveryPrompt,
    planRenderer: createPlanRenderer({
      store,
      planId,
      sessionId,
      token,
      resolvedPlanPath,
      initialSnapshot,
      isDiffPreview: diffPreviewSource !== undefined,
    }),
    readerProgress: createReaderProgress({
      initialSnapshot,
      observedResponseIds: initialExchange.responses.map(
        (response) => response.requestId,
      ),
    }),
    writeGate: createWriteGate({ mutations, stallMs: writeStallMs }),
    activityClock: createActivityClock(idleTimeoutMs),
    reportDiagnostic: ({ message, error }) => {
      try {
        process.stderr.write(
          `${message} for session ${sessionId}:\n${describeRuntimeFailure({ error, secrets: [token] })}\n`,
        );
      } catch {
        // A diagnostic sink failure must not fail the review request.
      }
    },
  };
  const { planRenderer } = context;

  /** Writes a route's decided response with the headers its kind carries. */
  const sendRouteResponse = ({
    response,
    value,
  }: {
    readonly response: ServerResponse;
    readonly value: ReviewRouteResponse;
  }): void => {
    if (value.kind === "binary") {
      sendBinary({
        response,
        status: value.status,
        contentType: value.contentType,
        body: value.body,
      });
      return;
    }
    sendJson({ response, status: value.status, value: value.value });
  };

  const handleDocument = async (response: ServerResponse): Promise<void> => {
    try {
      send({
        response,
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: await planRenderer.renderPlan(),
      });
    } catch (error: unknown) {
      const detail =
        error instanceof MarkdownDiagnosticsError
          ? error.diagnostics
              .map(
                ({ line, column, message }) =>
                  `${line ?? "?"}:${column ?? "?"} ${message}`,
              )
              .join("\n")
          : String(error);
      send({
        response,
        status: 500,
        contentType: "text/plain; charset=utf-8",
        body: `The plan could not be rendered.\n\n${detail}\n`,
      });
    }
  };

  const handle = async ({
    request,
    response,
  }: {
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
  }): Promise<void> => {
    let requestLabel = `${request.method ?? "?"} request`;
    let isMutation = false;
    try {
      const address = server.address();
      const port =
        typeof address === "object" && address !== null ? address.port : 0;
      const expectedHost = `127.0.0.1:${port}`;
      const origin = `http://${expectedHost}`;

      // Anti-rebinding, first and unconditionally: a name that resolves to
      // 127.0.0.1 is same-origin to the browser, so the address a request
      // arrived on proves nothing and the Host header is what must match.
      if (request.headers.host !== expectedHost) {
        refuse({ response, status: 403, reason: "Unrecognised host" });
        return;
      }

      const target = new URL(request.url ?? "/", origin);
      const method = request.method ?? "GET";

      if (method === DOCUMENT_ROUTE.method && target.pathname === "/") {
        requestLabel = `${method} /`;
        context.activityClock.touch();
        await handleDocument(response);
        return;
      }
      if (method === DOCUMENT_ROUTE.method) {
        for (const asset of ASSET_HANDLERS) {
          const value = await asset(context, { pathname: target.pathname });
          if (value !== undefined) {
            sendRouteResponse({ response, value });
            return;
          }
        }
      }

      const onPath = API_ROUTES.filter(
        (candidate) => candidate.path === target.pathname,
      );
      if (onPath.length === 0) {
        refuse({ response, status: 404, reason: "No such route" });
        return;
      }
      const matched = onPath.find((candidate) => candidate.method === method);
      if (matched === undefined) {
        refuse({ response, status: 405, reason: "Method not allowed here" });
        return;
      }
      requestLabel = `${matched.method} ${matched.path}`;
      isMutation = matched.method !== "GET";

      // No CORS allowance is ever sent, so a browser hides the response - but
      // a simple cross-origin POST still arrives, and would still be executed
      // without this check. These two headers are what refuse the write.
      const requestOrigin = request.headers.origin;
      if (requestOrigin !== undefined && requestOrigin !== origin) {
        refuse({ response, status: 403, reason: "Foreign origin" });
        return;
      }
      const site = request.headers["sec-fetch-site"];
      if (typeof site === "string" && site !== "same-origin") {
        refuse({ response, status: 403, reason: "Foreign site" });
        return;
      }

      const supplied = request.headers[TOKEN_HEADER];
      if (
        typeof supplied !== "string" ||
        !constantTimeEquals(supplied, token)
      ) {
        refuse({
          response,
          status: 401,
          reason: "Missing or wrong session token",
        });
        return;
      }

      // Above the method split on purpose: a page that only polls is a page
      // someone still has open, and treating its reads as idleness is what
      // used to close a session out from under a reader.
      context.activityClock.touch();

      // A slow client may occupy its own request, but it must not hold the
      // filesystem mutation gate while it is still streaming input.
      const binaryBody =
        matched.binary === true ? await readBinaryBody(request) : undefined;
      const body =
        matched.method === "GET" || matched.binary === true
          ? undefined
          : await readBody(request);
      const dispatch = async (): Promise<void> =>
        sendRouteResponse({
          response,
          value: await matched.handler(context, {
            query: target.searchParams,
            headers: request.headers,
            body,
            binaryBody,
          }),
        });
      if (matched.method === "GET") {
        await dispatch();
      } else {
        await context.writeGate.exclusively({
          route: `${matched.method} ${matched.path}`,
          work: async () => {
            const authority = await withReviewSessionAuthority({
              store,
              sessionId,
              change: dispatch,
            });
            if (!authority.authoritative) {
              refuse({
                response,
                status: 409,
                reason:
                  authority.reason === "stopped"
                    ? "This review session has stopped and can no longer accept changes"
                    : "This review was replaced by a newer session and is now read-only",
              });
            }
          },
        });
      }
    } catch (error: unknown) {
      if (response.headersSent) {
        // A dispatch that answered and then failed leaves nothing to refuse
        // with. Writing a second status would throw ERR_HTTP_HEADERS_SENT out
        // of this handler, and the caller runs it with `void`, so that throw
        // would become an unhandled rejection and end the CLI process.
        response.destroy();
        return;
      }
      if (error instanceof CommentRejected) {
        refuse({ response, status: 400, reason: error.message });
        return;
      }
      // A write the runtime gave up on answers rather than hanging, and it is
      // not reported here: the stall watchdog already names the route and its
      // age once, and repeating it for every later write would bury it.
      if (error instanceof ReviewWriteStalled) {
        refuse({
          response,
          status: 503,
          reason:
            "This review session has stopped accepting changes. Restart the review runtime to continue.",
        });
        return;
      }
      // The outer boundary is the only place with both the route and the
      // cause. A refused request the reviewer sees as a generic failure has to
      // leave a specific line behind, or a session that starts failing every
      // write reports nothing at all. A client that went away is not such a
      // failure: nothing is left to read the response, and a reviewer who
      // closed the page would otherwise fill the log.
      if (request.complete) {
        process.stderr.write(
          `Review request ${requestLabel} failed for session ${sessionId}:\n${describeRuntimeFailure({ error, secrets: [token] })}\n`,
        );
      }
      // A write that failed while another one is stalled failed because of it:
      // the abandoned work holds the store's custody lock until it settles. The
      // cause is already in the log above, so the reviewer gets the one thing
      // they can act on instead of a generic failure they cannot.
      if (isMutation && context.writeGate.stalledForMs() !== undefined) {
        refuse({
          response,
          status: 503,
          reason:
            "This review session has stopped accepting changes. Restart the review runtime to continue.",
        });
        return;
      }
      refuse({ response, status: 500, reason: "The review runtime failed" });
    }
  };

  // The socket was bound before custody was taken, so it has been accepting
  // connections with no request listener attached. Serving starts here, once
  // this session owns the plan and its state is initialized.
  server.on("request", (request, response) => {
    void handle({ request, response });
  });

  let connectionWrite = Promise.resolve();
  let connectionFailureReported = false;
  const queueConnectionCheck = (): Promise<void> => {
    connectionWrite = connectionWrite
      .catch(() => undefined)
      .then(async () => {
        // Presence alone. Work an agent is holding is evidence about that turn,
        // not about whether anyone is still attached, so it never reaches this
        // edge (BIG-147).
        const presence = await readAgentPresence({ store, sessionId });
        await recordAgentConnectionState({
          store,
          sessionId,
          connected: presence.connected,
          at: new Date().toISOString(),
          disconnectReason: "Heartbeat timed out",
        });
      })
      .catch((error: unknown) => {
        if (connectionFailureReported) return;
        connectionFailureReported = true;
        process.stderr.write(
          `Agent connection check failed for session ${sessionId} (${resolvedPlanPath}): ${String(error)}\n`,
        );
      });
    return connectionWrite;
  };
  await queueConnectionCheck();
  const connectionTimer = setInterval(() => {
    void queueConnectionCheck();
  }, REVIEW_HEARTBEAT_INTERVAL_MS);
  connectionTimer.unref();

  // A stalled mutation is reported once. Repeating it every five seconds would
  // bury the rest of the session's output without telling the reader anything
  // the first line did not already say.
  const reportedStalls = new Set<string>();
  const stallTimer = setInterval(() => {
    for (const mutation of stalledMutations({
      inFlight: mutations.inFlight(),
      nowMs: Date.now(),
      boundMs: writeStallMs,
    })) {
      if (reportedStalls.has(mutation.id)) continue;
      reportedStalls.add(mutation.id);
      process.stderr.write(
        `Review write stalled for session ${sessionId} (${resolvedPlanPath}): ${describeStalledMutation(mutation)}\n`,
      );
    }
  }, STALL_CHECK_INTERVAL_MS);
  stallTimer.unref();

  let reportedGrowthMilestone = 0;
  const growthTimer = setInterval(() => {
    void (async () => {
      const growth = await reviewStoreGrowth({ store }).catch(() => undefined);
      if (growth === undefined) return;
      const milestone = growthMilestone({
        growth,
        threshold: GROWTH_MILESTONE,
      });
      if (milestone <= reportedGrowthMilestone) return;
      reportedGrowthMilestone = milestone;
      process.stderr.write(
        `Review state growing for session ${sessionId} (${resolvedPlanPath}): ${growth.progressLines} progress lines, ${growth.agentRequests} agent requests, ${growth.agentResponses} agent responses\n`,
      );
    })();
  }, GROWTH_CHECK_INTERVAL_MS);
  growthTimer.unref();

  const diagnostics = (): ReviewRuntimeDiagnostics => {
    const nowMs = Date.now();
    const inFlight = mutations.inFlight();
    return {
      sessionId,
      planPath: resolvedPlanPath,
      nowMs,
      inFlight,
      stalled: stalledMutations({
        inFlight,
        nowMs,
        boundMs: writeStallMs,
      }),
    };
  };

  const diagnosticGrowth = (): Promise<ReviewStoreGrowth | undefined> =>
    reviewStoreGrowth({ store }).catch(() => undefined);

  let closed = false;
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  let queuedWorkIdleState:
    | {
        readonly requestKey: string;
        readonly expiresAtMs: number;
      }
    | undefined;
  const closeRuntime = async (
    reason = "The review session was stopped.",
    sessionAlreadyStopped = false,
  ): Promise<void> => {
    if (closed) return;
    if (!sessionAlreadyStopped) {
      await stopReviewSessionIfInactive({
        store,
        sessionId,
        stopReason: reason,
        inactive: async () => true,
      });
    }
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    clearInterval(connectionTimer);
    clearInterval(stallTimer);
    clearInterval(growthTimer);
    if (idleTimer !== undefined) clearInterval(idleTimer);
    await heartbeatWrite.catch(() => undefined);
    await connectionWrite.catch(() => undefined);
    await drainAndCloseServer(server);
  };
  if (idleTimeoutMs > 0) {
    idleTimer = setInterval(
      () => {
        void (async () => {
          if (closed || context.activityClock.idleForMs() < idleTimeoutMs)
            return;
          const reason = `The review session ended normally after ${reviewIdleDurationLabel(idleTimeoutMs)} of inactivity.`;
          const stopped = await stopReviewSessionIfInactive({
            store,
            sessionId,
            stopReason: reason,
            inactive: async () => {
              if (closed || context.activityClock.idleForMs() < idleTimeoutMs) {
                return false;
              }
              const requests = await readValidatedAgentRequests({
                store,
                sessionId,
                planId,
              });
              const nowMs = Date.now();
              if (
                requests.some((request) =>
                  requestBlocksPlanPickup({ request, nowMs }),
                )
              ) {
                queuedWorkIdleState = undefined;
                context.activityClock.touch();
                return false;
              }
              const queuedRequestKey = requests
                .filter((request) => !requestIsTerminal(request))
                .map((request) => request.requestId)
                .sort()
                .join(":");
              if (queuedRequestKey.length === 0) {
                queuedWorkIdleState = undefined;
                return true;
              }
              if (queuedWorkIdleState?.requestKey !== queuedRequestKey) {
                queuedWorkIdleState = {
                  requestKey: queuedRequestKey,
                  expiresAtMs: nowMs + queuedWorkIdleLimitMs,
                };
                context.activityClock.touch();
                return false;
              }
              if (nowMs < queuedWorkIdleState.expiresAtMs) {
                return false;
              }
              return true;
            },
          });
          if (stopped.stopped) {
            await closeRuntime(reason, true);
          }
        })();
      },
      Math.min(1_000, idleTimeoutMs),
    );
    idleTimer.unref();
  }

  return {
    url,
    port,
    sessionId,
    planId,
    planPath: resolvedPlanPath,
    store,
    ...(activation.displaced === undefined
      ? {}
      : { replacedSession: activation.displaced }),
    close: closeRuntime,
    diagnostics,
    diagnosticGrowth,
  };
};
