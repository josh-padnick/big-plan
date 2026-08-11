// The local review runtime: the loopback server that renders the plan, serves
// that document, holds the reviewer's drafts, and writes the feedback package
// on Send.
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
//  - A fixed route-and-method allow-list. No static passthrough, no directory
//    listing, and no path segment that reaches the filesystem.
//  - The document is always rendered in-process from the authoritative MDX. A
//    pre-existing .html is never served, because arbitrary HTML is arbitrary
//    script running on this runtime's own origin.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { basename, extname, resolve } from "node:path";
import {
  renderDocument,
  MarkdownDiagnosticsError,
} from "../render/render-document.js";
import type { BlockMapEntry, ReviewComment } from "./shared/comment.js";
import {
  CommentRejected,
  validateActiveDraft,
  validateCommentUpdates,
  validateResolvedCommentIds,
  validateStoredComments,
} from "./shared/comment.js";
import { buildFeedbackPackage, renderBrief } from "./feedback-package.js";
import type { FeedbackPackage } from "./feedback-package.js";
import {
  AgentExchangeRejected,
  deriveSnapshotDigest,
  feedbackAgentRequest,
  messageAgentRequest,
  readAgentCommentHistory,
  readAgentExchange,
  validateAgentRequest,
  validateAgentResponseDraft,
  writeAgentRequest,
} from "./agent-exchange.js";
import {
  appendProgressEvent,
  cancelAgentRequest,
  claimAgentRequest,
  ensureAgentRequest,
  publishAgentResponse,
  recordAgentConnectionState,
  removeCommentFromQueuedFeedbackRequest,
} from "./request-mailbox.js";
import {
  deriveReviewPlanId,
  prepareStore,
  randomId,
  readActiveDraft,
  readAgentConnectionEvents,
  readAgentPresence,
  readComments,
  readProgress,
  readFeedbackSubmissionValue,
  readResolvedCommentIds,
  readSnapshot,
  reviewStoreFor,
  writeActiveDraft,
  writeComments,
  writeFeedbackPackage,
  writeFeedbackSubmissionValue,
  writeResolvedCommentIds,
  writeSnapshot,
} from "./store.js";
import type { ReviewStore } from "./store.js";
import { buildSnapshotDiff } from "./snapshot-diff.js";
import {
  agentConnectCommand,
  agentRecoveryPrompt,
} from "./shared/agent-command.js";
import {
  encodeAgentSnapshot,
  encodeSnapshotDiff,
  encodeProgress,
  encodeReviewSnapshot,
  encodeRuntimeSession,
} from "./shared/review-wire.js";
import {
  activateReviewSession,
  REVIEW_HEARTBEAT_INTERVAL_MS,
  refreshReviewSessionHeartbeat,
  reviewSessionView,
  withReviewSessionAuthority,
} from "./session-authority.js";

const TOKEN_HEADER = "x-big-plan-review-token";
const BODY_LIMIT_BYTES = 1024 * 1024;
const SHUTDOWN_GRACE_MS = 100;

// Everything the document needs is embedded, and the only origin it may reach
// is this runtime. The browser enforces the egress boundary the design claims.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

type Route = {
  readonly method: "GET" | "PUT" | "POST";
  readonly path: string;
};

const DOCUMENT_ROUTE: Route = { method: "GET", path: "/" };

// The whole surface. A request that does not match one of these pairs exactly
// is refused before anything else looks at it.
const API_ROUTES: ReadonlyArray<Route> = [
  { method: "GET", path: "/api/session" },
  { method: "GET", path: "/api/drafts" },
  { method: "PUT", path: "/api/drafts" },
  { method: "POST", path: "/api/feedback" },
  { method: "POST", path: "/api/comments-delete" },
  { method: "GET", path: "/api/agent" },
  { method: "POST", path: "/api/agent-requests" },
  { method: "POST", path: "/api/agent-cancel" },
  { method: "GET", path: "/api/progress" },
  { method: "GET", path: "/api/snapshot-diff" },
];

/** A running review runtime. */
export type ReviewRuntime = {
  readonly url: string;
  readonly port: number;
  readonly sessionId: string;
  readonly planId: string;
  readonly planPath: string;
  readonly store: ReviewStore;
  readonly close: () => Promise<void>;
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

const refuse = ({
  response,
  status,
  reason,
}: {
  readonly response: ServerResponse;
  readonly status: number;
  readonly reason: string;
}): void => sendJson({ response, status, value: { error: reason } });

type FeedbackSubmission = {
  readonly version: 1;
  readonly submissionId: string;
  readonly feedback: FeedbackPackage;
  readonly source: string;
  readonly premiseSnapshot: string;
};

const feedbackSubmissionId = ({
  planId,
  comments,
}: {
  readonly planId: string;
  readonly comments: ReadonlyArray<ReviewComment>;
}): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        planId,
        comments: comments.map(({ id, body, premiseSnapshot, target }) => ({
          id,
          body,
          premiseSnapshot,
          target,
        })),
      }),
    )
    .digest("hex")
    .slice(0, 16);

const feedbackSubmissionContent = (
  comments: ReadonlyArray<ReviewComment>,
): string =>
  JSON.stringify(
    comments.map(({ id, body, premiseSnapshot, target }) => ({
      id,
      body,
      premiseSnapshot,
      target,
    })),
  );

const storedFeedbackSubmission = ({
  value,
  submissionId,
  planId,
  planPath,
  comments,
}: {
  readonly value: unknown;
  readonly submissionId: string;
  readonly planId: string;
  readonly planPath: string;
  readonly comments: ReadonlyArray<ReviewComment>;
}): FeedbackSubmission => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("version" in value) ||
    value.version !== 1 ||
    !("submissionId" in value) ||
    value.submissionId !== submissionId ||
    !("feedback" in value) ||
    typeof value.feedback !== "object" ||
    value.feedback === null ||
    Array.isArray(value.feedback) ||
    !("version" in value.feedback) ||
    value.feedback.version !== 1 ||
    !("packageId" in value.feedback) ||
    value.feedback.packageId !== submissionId ||
    !("planId" in value.feedback) ||
    value.feedback.planId !== planId ||
    !("planPath" in value.feedback) ||
    value.feedback.planPath !== planPath ||
    !("sessionId" in value.feedback) ||
    typeof value.feedback.sessionId !== "string" ||
    !("createdAt" in value.feedback) ||
    typeof value.feedback.createdAt !== "string" ||
    !("comments" in value.feedback) ||
    !("source" in value) ||
    typeof value.source !== "string" ||
    !("premiseSnapshot" in value) ||
    typeof value.premiseSnapshot !== "string" ||
    value.premiseSnapshot !== deriveSnapshotDigest(value.source)
  ) {
    throw new Error("The stored feedback submission is invalid");
  }
  const storedComments = validateStoredComments({
    value: value.feedback.comments,
    now: new Date().toISOString(),
  });
  if (
    feedbackSubmissionContent(storedComments) !==
    feedbackSubmissionContent(comments)
  ) {
    throw new Error("The stored feedback submission conflicts with this retry");
  }
  const candidateFeedback = buildFeedbackPackage({
    sessionId: value.feedback.sessionId,
    packageId: submissionId,
    planId,
    planPath,
    createdAt: value.feedback.createdAt,
    comments: storedComments,
  });
  const request = validateAgentRequest(
    feedbackAgentRequest({
      feedback: candidateFeedback,
      premiseSnapshot: value.premiseSnapshot,
    }),
  );
  if (request.kind !== "feedback") {
    throw new Error("The stored feedback submission is invalid");
  }
  const feedback = buildFeedbackPackage({
    sessionId: request.sessionId,
    packageId: request.packageId,
    planId: request.planId,
    planPath,
    createdAt: request.createdAt,
    comments: request.comments,
  });
  return {
    version: 1,
    submissionId,
    feedback,
    source: value.source,
    premiseSnapshot: request.premiseSnapshot,
  };
};

/**
 * Starts the review runtime for one plan and resolves once it is listening.
 * The caller owns the plan path; nothing about a request ever contributes one.
 */
export const startReviewRuntime = async ({
  planPath,
  diffPreviewSource,
}: {
  readonly planPath: string;
  readonly diffPreviewSource?: string;
}): Promise<ReviewRuntime> => {
  const resolvedPlanPath = resolve(planPath);
  const executablePath = resolve(process.argv[1] ?? "bin/big-plan.mjs");
  const agentCommand = agentConnectCommand({
    executablePath,
    planPath: resolvedPlanPath,
  });
  const recoveryPrompt = agentRecoveryPrompt({
    executablePath,
    planPath: resolvedPlanPath,
  });
  const planId = deriveReviewPlanId({ planPath: resolvedPlanPath });
  const sessionId = randomId(8);
  const token = randomBytes(32).toString("base64url");
  const store = reviewStoreFor({ planPath: resolvedPlanPath, planId });
  await prepareStore(store);
  const initialSource = await readFile(resolvedPlanPath, "utf8");
  renderDocument({
    markdown: initialSource,
    fallbackTitle: basename(resolvedPlanPath, extname(resolvedPlanPath)),
    identity: {},
  });
  const initialSnapshot = deriveSnapshotDigest(initialSource);
  await writeSnapshot({
    store,
    snapshot: initialSnapshot,
    source: initialSource,
  });
  const storedComments = (path: string) =>
    readComments({
      path,
      validate: (value) =>
        validateStoredComments({ value, now: new Date().toISOString() }),
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
          location.newBlockId === undefined ? [] : [location.newBlockId],
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
      requestId: feedbackRequest.requestId,
      baselineSnapshot: premiseSnapshot,
      now: createdAt,
    });
    await publishAgentResponse({
      store,
      response: validateAgentResponseDraft({
        value: {
          requestId: feedbackRequest.requestId,
          outcomes: [
            {
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
      requestId: historicalRequest.requestId,
      baselineSnapshot: premiseSnapshot,
      now: new Date(Date.parse(createdAt) + 1).toISOString(),
    });
    await publishAgentResponse({
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
      requestId: chatRequest.requestId,
      baselineSnapshot: premiseSnapshot,
      now: new Date(Date.parse(createdAt) + 2).toISOString(),
    });
    await publishAgentResponse({
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

  // The current render map authorizes newly created targets. Stored comments
  // carry their already-validated target metadata across later revisions.
  const blocks = new Map<string, BlockMapEntry>();
  let blockMapMarkdown: string | undefined;
  const initialExchange = await readAgentExchange({ store, sessionId, planId });
  const observedResponseIds = new Set(
    initialExchange.responses.map((response) => response.requestId),
  );
  let acceptedSnapshot = initialSnapshot;

  const validateStored = (value: unknown): ReadonlyArray<ReviewComment> =>
    validateStoredComments({ value, now: new Date().toISOString() });

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
      diffPreview: diffPreviewSource !== undefined,
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

  // Mutating requests share filesystem-backed state. Keep each full mutation
  // atomic so overlapping browser requests cannot lose one another's writes.
  let writeGate: Promise<unknown> = Promise.resolve();
  const exclusively = <T>(work: () => Promise<T>): Promise<T> => {
    const next = writeGate.then(work, work);
    writeGate = next.catch(() => undefined);
    return next;
  };

  const handleDocument = async (response: ServerResponse): Promise<void> => {
    try {
      send({
        response,
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: await renderPlan(),
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

  const handleApi = async ({
    route,
    response,
    query,
    body,
  }: {
    readonly route: Route;
    readonly response: ServerResponse;
    readonly query: URLSearchParams;
    readonly body?: unknown;
  }): Promise<void> => {
    if (route.path === "/api/session") {
      const sessionView = await reviewSessionView({
        store,
        sessionId,
        planId,
        plan: resolvedPlanPath,
      });
      sendJson({
        response,
        status: 200,
        value: encodeRuntimeSession(sessionView),
      });
      return;
    }
    if (route.path === "/api/drafts" && route.method === "GET") {
      // The document must exist before drafts can be resolved, because the
      // block map is what makes a stored target meaningful.
      await renderPlan();
      sendJson({
        response,
        status: 200,
        value: encodeReviewSnapshot({
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
      });
      return;
    }
    if (route.path === "/api/drafts") {
      const payload =
        typeof body === "object" && body !== null
          ? (body as Readonly<Record<string, unknown>>)
          : {};
      const drafts = await validateUpdates(payload.drafts);
      const activeDraft = validateActiveDraft(payload.activeDraft);
      const resolvedCommentIds = validateResolvedCommentIds(
        payload.resolvedCommentIds,
      );
      const sentIds = new Set(
        (await readStoredComments(store.sentPath)).map((comment) => comment.id),
      );
      const unsentDrafts = drafts.filter((draft) => !sentIds.has(draft.id));
      await writeComments({ path: store.draftsPath, comments: unsentDrafts });
      await writeActiveDraft({
        path: store.activeDraftPath,
        value: activeDraft,
      });
      await writeResolvedCommentIds({ store, ids: resolvedCommentIds });
      sendJson({
        response,
        status: 200,
        value: { drafts: unsentDrafts.length },
      });
      return;
    }
    if (route.path === "/api/feedback") {
      const payload =
        typeof body === "object" && body !== null
          ? (body as Readonly<Record<string, unknown>>)
          : {};
      const comments = await validateUpdates(payload.comments);
      if (comments.length === 0) {
        refuse({ response, status: 400, reason: "Nothing to send" });
        return;
      }
      const alreadySent = await readStoredComments(store.sentPath);
      const sentById = new Map(
        alreadySent.map((comment) => [comment.id, comment]),
      );
      if (
        comments.some((comment) => {
          const existing = sentById.get(comment.id);
          return (
            existing !== undefined &&
            JSON.stringify(existing) !== JSON.stringify(comment)
          );
        })
      ) {
        refuse({
          response,
          status: 409,
          reason: "A sent comment id cannot be reused for different feedback",
        });
        return;
      }
      const newlySent = comments.filter((comment) => !sentById.has(comment.id));
      const submittedIds = new Set(comments.map((comment) => comment.id));
      const remainingDrafts = (
        await readStoredComments(store.draftsPath)
      ).filter((comment) => !submittedIds.has(comment.id));
      if (newlySent.length === 0) {
        await writeComments({
          path: store.draftsPath,
          comments: remainingDrafts,
        });
        await writeActiveDraft({ path: store.activeDraftPath, value: "" });
        sendJson({
          response,
          status: 200,
          value: { comments: 0, retried: true },
        });
        return;
      }
      const submissionId = feedbackSubmissionId({
        planId,
        comments: newlySent,
      });
      const storedSubmission = await readFeedbackSubmissionValue({
        store,
        submissionId,
      });
      let submission: FeedbackSubmission;
      if (storedSubmission === undefined) {
        const source = await readFile(resolvedPlanPath, "utf8");
        const premiseSnapshot = deriveSnapshotDigest(source);
        const feedback = buildFeedbackPackage({
          sessionId,
          packageId: submissionId,
          planId,
          planPath: resolvedPlanPath,
          createdAt: new Date().toISOString(),
          comments: newlySent,
        });
        submission = {
          version: 1,
          submissionId,
          feedback,
          source,
          premiseSnapshot,
        };
        await writeFeedbackSubmissionValue({
          store,
          submissionId,
          value: submission,
        });
      } else {
        submission = storedFeedbackSubmission({
          value: storedSubmission,
          submissionId,
          planId,
          planPath: resolvedPlanPath,
          comments: newlySent,
        });
      }
      const { feedback, source, premiseSnapshot } = submission;
      const written = await writeFeedbackPackage({
        store,
        feedback,
        brief: renderBrief(feedback),
      });
      await writeSnapshot({ store, snapshot: premiseSnapshot, source });
      const agentRequest = await ensureAgentRequest({
        store,
        request: feedbackAgentRequest({
          feedback,
          premiseSnapshot,
        }),
      });
      await writeComments({
        path: store.sentPath,
        comments: [...alreadySent, ...feedback.comments],
      });
      await writeComments({
        path: store.draftsPath,
        comments: remainingDrafts,
      });
      await writeActiveDraft({ path: store.activeDraftPath, value: "" });
      // The one event the runtime can honestly author: it has the package.
      // Everything after this belongs to the agent that reads the channel.
      await appendProgressEvent({
        store,
        event: {
          sessionId,
          atMs: Date.now(),
          stepCode: "feedback-received",
          step: "Feedback package received",
          state: "done",
          detail: `${newlySent.length} comment${newlySent.length === 1 ? "" : "s"}`,
        },
      });
      sendJson({
        response,
        status: 200,
        value: {
          packageId: feedback.packageId,
          comments: newlySent.length,
          package: written.jsonPath,
          brief: written.briefPath,
          agentRequest,
        },
      });
      return;
    }
    if (route.path === "/api/comments-delete") {
      const payload =
        typeof body === "object" && body !== null
          ? (body as Readonly<Record<string, unknown>>)
          : {};
      const commentId = payload.commentId;
      if (typeof commentId !== "string") {
        refuse({ response, status: 400, reason: "A comment id is required" });
        return;
      }
      const sent = await readStoredComments(store.sentPath);
      if (!sent.some((comment) => comment.id === commentId)) {
        refuse({ response, status: 404, reason: "No such sent comment" });
        return;
      }
      const exchange = await readAgentCommentHistory({
        store,
        sessionId,
        planId,
        commentId,
      });
      const answeredRequestIds = new Set(
        exchange.responses.flatMap((candidate) =>
          candidate.kind !== "chat" &&
          candidate.outcomes.some((outcome) => outcome.commentId === commentId)
            ? [candidate.requestId]
            : [],
        ),
      );
      const commentRequests = exchange.requests;
      if (answeredRequestIds.size > 0 || commentRequests.length === 0) {
        refuse({
          response,
          status: 409,
          reason:
            "Only a queued or canceled comment can be deleted from the review",
        });
        return;
      }
      if (
        commentRequests.some((candidate) => candidate.claimedAt !== undefined)
      ) {
        refuse({
          response,
          status: 409,
          reason: "The agent has already picked up this comment",
        });
        return;
      }
      const pendingRequests = commentRequests.filter(
        (candidate) => candidate.canceledAt === undefined,
      );
      const now = new Date().toISOString();
      for (const pending of pendingRequests) {
        if (pending.canceledAt !== undefined) continue;
        if (pending.kind === "feedback") {
          await removeCommentFromQueuedFeedbackRequest({
            store,
            requestId: pending.requestId,
            commentId,
            now,
          });
        } else {
          await cancelAgentRequest({
            store,
            requestId: pending.requestId,
            now,
          });
        }
      }
      await writeComments({
        path: store.sentPath,
        comments: sent.filter((comment) => comment.id !== commentId),
      });
      const resolvedCommentIds = await readResolvedCommentIds({
        store,
        validate: validateResolvedCommentIds,
      });
      await writeResolvedCommentIds({
        store,
        ids: resolvedCommentIds.filter((id) => id !== commentId),
      });
      await appendProgressEvent({
        store,
        event: {
          sessionId,
          atMs: Date.now(),
          stepCode: "queued-comment-deleted",
          step: "Queued comment deleted",
          state: "done",
        },
      });
      sendJson({ response, status: 200, value: { commentId } });
      return;
    }
    if (route.path === "/api/agent") {
      const exchange = await readAgentExchange({ store, sessionId, planId });
      for (const agentResponse of exchange.responses) {
        if (!observedResponseIds.has(agentResponse.requestId)) {
          acceptedSnapshot = agentResponse.resultSnapshot;
        }
        observedResponseIds.add(agentResponse.requestId);
      }
      const presence = await readAgentPresence({ store, sessionId });
      const connectionLog = await readAgentConnectionEvents({
        store,
        sessionId,
      });
      sendJson({
        response,
        status: 200,
        value: encodeAgentSnapshot({
          // The browser reloads only revisions the response command has
          // rendered, linted, and accepted. Watching the raw file here would
          // navigate the reviewer onto a transient parse error while an agent
          // is midway through editing the authoritative MDX.
          currentSnapshot: acceptedSnapshot,
          presence,
          connectionLog,
          plan: resolvedPlanPath,
          agentCommand,
          recoveryPrompt,
          requests: exchange.requests,
          responses: exchange.responses,
        }),
      });
      return;
    }
    if (route.path === "/api/agent-requests") {
      const payload =
        typeof body === "object" && body !== null
          ? (body as Readonly<Record<string, unknown>>)
          : {};
      const kind = payload.kind;
      if (kind !== "reply" && kind !== "chat") {
        refuse({
          response,
          status: 400,
          reason: 'An agent request kind must be "reply" or "chat"',
        });
        return;
      }
      const messageBody =
        typeof payload.body === "string" ? payload.body.trim() : "";
      if (messageBody === "") {
        refuse({
          response,
          status: 400,
          reason: "An agent request needs a body",
        });
        return;
      }
      const source = await readFile(resolvedPlanPath, "utf8");
      const premiseSnapshot = deriveSnapshotDigest(source);
      await writeSnapshot({ store, snapshot: premiseSnapshot, source });
      const agentRequest = messageAgentRequest({
        kind,
        requestId: randomId(8),
        sessionId,
        planId,
        premiseSnapshot,
        createdAt: new Date().toISOString(),
        body: messageBody,
        ...(kind === "reply" && typeof payload.commentId === "string"
          ? { commentId: payload.commentId }
          : {}),
      });
      if (agentRequest.kind === "reply") {
        const sent = await readStoredComments(store.sentPath);
        if (!sent.some((comment) => comment.id === agentRequest.commentId)) {
          refuse({
            response,
            status: 400,
            reason: "The reply points at a comment this session did not send",
          });
          return;
        }
      }
      await writeAgentRequest({ store, request: agentRequest });
      await appendProgressEvent({
        store,
        event: {
          sessionId,
          atMs: Date.now(),
          stepCode: agentRequest.kind === "reply" ? "reply-sent" : "chat-sent",
          step:
            agentRequest.kind === "reply"
              ? "Reply sent to agent"
              : "Plan question sent to agent",
          state: "waiting",
        },
      });
      sendJson({
        response,
        status: 200,
        value: {
          requestId: agentRequest.requestId,
          kind: agentRequest.kind,
          request: agentRequest,
        },
      });
      return;
    }
    if (route.path === "/api/agent-cancel") {
      const payload =
        typeof body === "object" && body !== null
          ? (body as Readonly<Record<string, unknown>>)
          : {};
      const requestId = payload.requestId;
      if (typeof requestId !== "string") {
        refuse({ response, status: 400, reason: "A request id is required" });
        return;
      }
      const exchange = await readAgentExchange({ store, sessionId, planId });
      const agentRequest = exchange.requests.find(
        (candidate) => candidate.requestId === requestId,
      );
      if (agentRequest === undefined) {
        refuse({ response, status: 404, reason: "No such agent request" });
        return;
      }
      if (
        exchange.responses.some(
          (candidate) => candidate.requestId === agentRequest.requestId,
        )
      ) {
        refuse({
          response,
          status: 409,
          reason: "The agent has already answered this request",
        });
        return;
      }
      let canceled;
      try {
        canceled = await cancelAgentRequest({
          store,
          requestId: agentRequest.requestId,
          now: new Date().toISOString(),
        });
      } catch (error: unknown) {
        if (!(error instanceof AgentExchangeRejected)) throw error;
        refuse({ response, status: 409, reason: error.message });
        return;
      }
      await appendProgressEvent({
        store,
        event: {
          sessionId,
          requestId: canceled.requestId,
          atMs: Date.now(),
          stepCode: "request-canceled",
          step: "Request canceled by reviewer",
          state: "done",
        },
      });
      sendJson({ response, status: 200, value: { request: canceled } });
      return;
    }
    if (route.path === "/api/snapshot-diff") {
      const from = query.get("from") ?? "";
      const to = query.get("to") ?? "";
      if (!/^[a-f0-9]{16,64}$/.test(from) || !/^[a-f0-9]{16,64}$/.test(to)) {
        refuse({
          response,
          status: 400,
          reason: "Snapshot diff requires hexadecimal from and to snapshots",
        });
        return;
      }
      let beforeSource: string;
      let afterSource: string;
      try {
        [beforeSource, afterSource] = await Promise.all([
          readSnapshot({ store, snapshot: from }),
          readSnapshot({ store, snapshot: to }),
        ]);
      } catch {
        refuse({
          response,
          status: 404,
          reason: "This diff's baseline or result snapshot is unavailable",
        });
        return;
      }
      const fallbackTitle = basename(
        resolvedPlanPath,
        extname(resolvedPlanPath),
      );
      const before = renderDocument({
        markdown: beforeSource,
        fallbackTitle,
        identity: {},
      });
      const after = renderDocument({
        markdown: afterSource,
        fallbackTitle,
        identity: {},
      });
      sendJson({
        response,
        status: 200,
        value: encodeSnapshotDiff(
          buildSnapshotDiff({
            from,
            to,
            before: before.blocks,
            after: after.blocks,
          }),
        ),
      });
      return;
    }
    if (route.path === "/api/progress") {
      const events = await readProgress({ store, sessionId });
      sendJson({ response, status: 200, value: encodeProgress({ events }) });
      return;
    }
    throw new Error(`Unhandled review route ${route.path}`);
  };

  const handle = async ({
    request,
    response,
  }: {
    readonly request: IncomingMessage;
    readonly response: ServerResponse;
  }): Promise<void> => {
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
        await handleDocument(response);
        return;
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

      // A slow client may occupy its own request, but it must not hold the
      // filesystem mutation gate while it is still streaming input.
      const body =
        matched.method === "GET" ? undefined : await readBody(request);
      const dispatch = () =>
        handleApi({
          route: matched,
          response,
          query: target.searchParams,
          body,
        });
      if (matched.method === "GET") {
        await dispatch();
      } else {
        await exclusively(async () => {
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
                "This review was replaced by a newer session and is now read-only",
            });
          }
        });
      }
    } catch (error: unknown) {
      if (error instanceof CommentRejected) {
        refuse({ response, status: 400, reason: error.message });
        return;
      }
      refuse({ response, status: 500, reason: "The review runtime failed" });
    }
  };

  const server: Server = createServer((request, response) => {
    void handle({ request, response });
  });

  await new Promise<void>((settle, fail) => {
    server.once("error", fail);
    server.listen({ host: "127.0.0.1", port: 0 }, settle);
  });

  const address = server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  const url = `http://127.0.0.1:${port}/`;

  await activateReviewSession({
    store,
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
  });
  let heartbeatWrite = Promise.resolve();
  let heartbeatFailureReported = false;
  const queueHeartbeat = (running: boolean): Promise<void> => {
    heartbeatWrite = heartbeatWrite
      .catch(() => undefined)
      .then(async () => {
        await refreshReviewSessionHeartbeat({
          store,
          sessionId,
          running,
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
  await queueHeartbeat(true);
  const heartbeatTimer = setInterval(() => {
    void queueHeartbeat(true);
  }, REVIEW_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  let connectionWrite = Promise.resolve();
  let connectionFailureReported = false;
  const queueConnectionCheck = (): Promise<void> => {
    connectionWrite = connectionWrite
      .catch(() => undefined)
      .then(async () => {
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

  return {
    url,
    port,
    sessionId,
    planId,
    planPath: resolvedPlanPath,
    store,
    close: async () => {
      clearInterval(heartbeatTimer);
      clearInterval(connectionTimer);
      await queueHeartbeat(false).catch(() => undefined);
      await connectionWrite.catch(() => undefined);
      const closed = new Promise<void>((settle) => {
        server.close(() => settle());
      });
      server.closeIdleConnections();
      const forceClose = setTimeout(() => {
        server.closeAllConnections();
      }, SHUTDOWN_GRACE_MS);
      forceClose.unref();
      try {
        await closed;
      } finally {
        clearTimeout(forceClose);
      }
    },
  };
};
