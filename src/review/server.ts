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
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { basename, dirname, extname, resolve } from "node:path";
import { fromHtml } from "hast-util-from-html";
import { toHtml } from "hast-util-to-html";
import type { Element, Root, RootContent, ElementContent } from "hast";
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
  freezeRequestAttachments,
  publishReviewImage,
  readReviewImage,
  readFeedbackSubmissionValue,
  readResolvedCommentIds,
  readStagedInputs,
  readSnapshot,
  reviewStoreFor,
  writeActiveDraft,
  writeComments,
  writeFeedbackPackage,
  writeFeedbackSubmissionValue,
  writeResolvedCommentIds,
  writeSnapshot,
  writeStagedInputs,
} from "./store.js";
import type { ReviewStore } from "./store.js";
import { reviewPlanAssetName } from "./plan-assets.js";
import {
  extractReviewImageReferences,
  MAX_IMAGES_PER_MESSAGE,
  MAX_MESSAGE_IMAGE_BYTES,
  RAW_IMAGE_BODY_LIMIT,
} from "./shared/review-image.js";
import { buildSnapshotDiff, usesRenderedSnapshot } from "./snapshot-diff.js";
import {
  agentConnectCommand,
  agentRecoveryPrompt,
} from "./shared/agent-command.js";
import {
  encodeAgentSnapshot,
  encodeSnapshotDiff,
  encodeProgress,
  encodeReviewState,
  encodeReviewSnapshot,
  encodeRuntimeSession,
} from "./shared/review-wire.js";
import {
  applyStagedInputMutation,
  currentAnswers,
  PlanInputsRejected,
  supersededDecisionIds,
  validateStagedInputMutation,
  validateStagedInputs,
  type StagedInputs,
} from "./plan-inputs-store.js";
import {
  deriveDecisionInventory,
  type DecisionInventory,
} from "./decision-inventory.js";
import {
  activateReviewSession,
  REVIEW_HEARTBEAT_INTERVAL_MS,
  readCurrentReviewSession,
  refreshReviewSessionHeartbeat,
  reviewSessionView,
  withReviewSessionAuthority,
} from "./session-authority.js";

const TOKEN_HEADER = "x-big-plan-review-token";
const BODY_LIMIT_BYTES = 1024 * 1024;
const SHUTDOWN_GRACE_MS = 100;
const isHastElement = (node: RootContent | ElementContent): node is Element =>
  node.type === "element";

const findRenderedBlock = ({
  node,
  blockId,
}: {
  readonly node: Root | Element;
  readonly blockId: string;
}): Element | null => {
  for (const child of node.children) {
    if (!isHastElement(child)) continue;
    if (child.properties.dataBlockId === blockId) return child;
    const nested = findRenderedBlock({ node: child, blockId });
    if (nested !== null) return nested;
  }
  return null;
};

/** Extracts trusted inert component markup so historical snapshots keep their real presentation. */
const renderedBlockHtml = ({
  html,
  blockId,
  namespace,
}: {
  readonly html: string;
  readonly blockId: string | undefined;
  readonly namespace: string;
}): string | undefined => {
  if (blockId === undefined) return undefined;
  const root = fromHtml(html);
  const block = findRenderedBlock({ node: root, blockId });
  if (block === null) return undefined;
  const idPrefix = `review-diff-${namespace.replaceAll(/[^a-z0-9_-]/giu, "-")}-${blockId.replaceAll(/[^a-z0-9_-]/giu, "-")}-`;
  const identifiers = new Map<string, string>();
  const collectIdentifiers = (node: Element): void => {
    if (typeof node.properties.id === "string") {
      identifiers.set(node.properties.id, `${idPrefix}${node.properties.id}`);
    }
    for (const child of node.children) {
      if (isHastElement(child)) collectIdentifiers(child);
    }
  };
  collectIdentifiers(block);
  const rewriteReferences = (value: string): string => {
    const exactReplacement = identifiers.get(value);
    if (exactReplacement !== undefined) return exactReplacement;
    const tokens = value.split(/\s+/u);
    if (tokens.length > 1 && tokens.every((token) => identifiers.has(token))) {
      return tokens.map((token) => identifiers.get(token) ?? token).join(" ");
    }
    return value.replace(
      /url\(#([^)]+)\)|#([A-Za-z][A-Za-z0-9_:-]*)/gu,
      (
        match,
        urlIdentifier: string | undefined,
        hashIdentifier: string | undefined,
      ) => {
        const identifier = urlIdentifier ?? hashIdentifier;
        if (identifier === undefined) return match;
        const replacement = identifiers.get(identifier);
        if (replacement === undefined) return match;
        return urlIdentifier === undefined
          ? `#${replacement}`
          : `url(#${replacement})`;
      },
    );
  };
  const scrubReviewIdentity = (node: Element): void => {
    delete node.properties.dataBlockId;
    delete node.properties.dataReviewSlideSelectable;
    delete node.properties.dataReviewSlideSelected;
    for (const [property, value] of Object.entries(node.properties)) {
      if (typeof value === "string") {
        node.properties[property] = rewriteReferences(value);
      } else if (Array.isArray(value)) {
        node.properties[property] = value.map((entry) =>
          typeof entry === "string" ? rewriteReferences(entry) : entry,
        );
      }
    }
    for (const child of node.children) {
      if (isHastElement(child)) scrubReviewIdentity(child);
      else if (node.tagName === "style" && child.type === "text") {
        child.value = rewriteReferences(child.value);
      }
    }
  };
  scrubReviewIdentity(block);
  return toHtml(block, { allowDangerousHtml: false });
};

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

type Route = {
  readonly method: "GET" | "PUT" | "POST";
  readonly path: string;
  readonly binary?: boolean;
};

const DOCUMENT_ROUTE: Route = { method: "GET", path: "/" };

// The whole surface. A request that does not match one of these pairs exactly
// is refused before anything else looks at it.
const API_ROUTES: ReadonlyArray<Route> = [
  { method: "GET", path: "/api/session" },
  { method: "GET", path: "/api/review-state" },
  { method: "POST", path: "/api/inputs" },
  { method: "GET", path: "/api/drafts" },
  { method: "PUT", path: "/api/drafts" },
  { method: "POST", path: "/api/feedback" },
  { method: "POST", path: "/api/comments-delete" },
  { method: "POST", path: "/api/revert-agent-changes" },
  { method: "GET", path: "/api/agent" },
  { method: "POST", path: "/api/agent-requests" },
  { method: "POST", path: "/api/agent-cancel" },
  { method: "GET", path: "/api/progress" },
  { method: "GET", path: "/api/snapshot-diff" },
  { method: "POST", path: "/api/review-images", binary: true },
  { method: "GET", path: "/api/review-images" },
];

/** A running review runtime. */
export type ReviewRuntime = {
  readonly url: string;
  readonly port: number;
  readonly sessionId: string;
  readonly planId: string;
  readonly planPath: string;
  readonly store: ReviewStore;
  readonly close: (reason?: string) => Promise<void>;
};

const constantTimeEquals = (left: string, right: string): boolean => {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  // Length is not secret, and timingSafeEqual requires equal lengths.
  return a.length === b.length && timingSafeEqual(a, b);
};

const replacePlanSource = async ({
  path,
  source,
}: {
  readonly path: string;
  readonly source: string;
}): Promise<void> => {
  const temporaryPath = `${path}.big-plan-revert-${randomBytes(8).toString("hex")}`;
  const mode = (await stat(path)).mode;
  try {
    await writeFile(temporaryPath, source, { flag: "wx", mode });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
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
    "content-security-policy": CONTENT_SECURITY_POLICY,
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

type FeedbackSubmission = {
  readonly version: 2;
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

const imageReferencesForBodies = (bodies: ReadonlyArray<string>) => {
  const seen = new Set<string>();
  return bodies
    .flatMap((body) => extractReviewImageReferences(body))
    .filter((reference) => {
      if (seen.has(reference.id)) return false;
      seen.add(reference.id);
      return true;
    });
};

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
    value.version !== 2 ||
    !("submissionId" in value) ||
    value.submissionId !== submissionId ||
    !("feedback" in value) ||
    typeof value.feedback !== "object" ||
    value.feedback === null ||
    Array.isArray(value.feedback) ||
    !("version" in value.feedback) ||
    value.feedback.version !== 2 ||
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
    fallbackPremiseSnapshot: deriveSnapshotDigest(value.source),
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
    attachments: Array.isArray(
      (value.feedback as Record<string, unknown>).attachments,
    )
      ? ((value.feedback as Record<string, unknown>)
          .attachments as FeedbackPackage["attachments"])
      : [],
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
    attachments: request.attachments,
  });
  return {
    version: 2,
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
  idleTimeoutMs = 10 * 60 * 1_000,
}: {
  readonly planPath: string;
  readonly diffPreviewSource?: string;
  readonly idleTimeoutMs?: number;
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
  const store = reviewStoreFor({ planPath: resolvedPlanPath, planId });
  await prepareStore(store);
  const previousSession = await readCurrentReviewSession({ store });
  // The token protects the durable image store as well as the live mailbox.
  // Reuse it for this plan so a browser page can reconnect after a runtime
  // restart without turning already-sent images into missing references.
  const token = previousSession?.token ?? randomBytes(32).toString("base64url");
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
      diffPreview: diffPreviewSource !== undefined,
    });

  // The compiled inventory of decisions the plan currently asks. It is derived
  // from the same source the document is rendered from, keyed by that source's
  // digest, so it can never describe a plan the reader was not served.
  let inventoryDigest: string | undefined;
  let inventory: DecisionInventory = new Map();
  const decisionInventory = async (): Promise<DecisionInventory> => {
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
  };

  // Total answer loss deserves one line a human can act on. Reported once per
  // runtime, because every later read of the same file would repeat it and the
  // next accepted write replaces the record anyway.
  let reportedUnreadableAnswers = false;
  const readAnswers = async (): Promise<StagedInputs> => {
    const { inputs, unreadable } = await readStagedInputs({
      store,
      validate: validateStagedInputs,
    });
    if (unreadable !== undefined && !reportedUnreadableAnswers) {
      reportedUnreadableAnswers = true;
      console.error(
        `Stored decision answers could not be read and were treated as empty: ${unreadable}`,
      );
    }
    return inputs;
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

  const handlePlanAsset = async ({
    response,
    pathname,
  }: {
    readonly response: ServerResponse;
    readonly pathname: string;
  }): Promise<boolean> => {
    const match =
      /^\/assets\/(review-image-[a-f0-9]{64}\.(?:png|jpg|webp))$/u.exec(
        pathname,
      );
    const name = match?.[1];
    if (name === undefined || !reviewPlanAssetName(name)) return false;
    try {
      const bytes = await readFile(
        resolve(dirname(resolvedPlanPath), "assets", name),
      );
      sendBinary({
        response,
        status: 200,
        contentType: name.endsWith(".jpg")
          ? "image/jpeg"
          : name.endsWith(".webp")
            ? "image/webp"
            : "image/png",
        body: Uint8Array.from(bytes),
      });
    } catch {
      refuse({ response, status: 404, reason: "Plan asset unavailable" });
    }
    return true;
  };

  const handleApi = async ({
    route,
    response,
    query,
    body,
    binaryBody,
  }: {
    readonly route: Route;
    readonly response: ServerResponse;
    readonly query: URLSearchParams;
    readonly body?: unknown;
    readonly binaryBody?: Uint8Array;
  }): Promise<void> => {
    if (route.path === "/api/review-images" && route.method === "POST") {
      if (binaryBody === undefined || binaryBody.byteLength === 0) {
        refuse({ response, status: 400, reason: "An image body is required" });
        return;
      }
      const altHeader = response.req.headers["x-big-plan-image-alt"];
      const alt =
        typeof altHeader === "string" && altHeader.trim() !== ""
          ? altHeader.trim().slice(0, 200)
          : "Screenshot";
      try {
        sendJson({
          response,
          status: 200,
          value: await publishReviewImage({ store, bytes: binaryBody, alt }),
        });
      } catch (error: unknown) {
        refuse({
          response,
          status: 400,
          reason:
            error instanceof Error ? error.message : "The image is invalid",
        });
      }
      return;
    }
    if (route.path === "/api/review-images" && route.method === "GET") {
      const id = query.get("id");
      if (id === null) {
        refuse({ response, status: 400, reason: "An image id is required" });
        return;
      }
      const image = await readReviewImage({ store, id });
      if (image === undefined) {
        refuse({ response, status: 404, reason: "Image unavailable" });
        return;
      }
      sendBinary({
        response,
        status: 200,
        contentType: image.descriptor.mimeType,
        body: image.bytes,
      });
      return;
    }
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
    if (route.path === "/api/review-state") {
      const inventoryNow = await decisionInventory();
      const inputs = await readAnswers();
      sendJson({
        response,
        status: 200,
        value: encodeReviewState({
          answers: currentAnswers({ inputs, inventory: inventoryNow }),
          supersededDecisionIds: supersededDecisionIds({
            inputs,
            inventory: inventoryNow,
          }),
          revision: inputs.revision,
        }),
      });
      return;
    }
    if (route.path === "/api/inputs") {
      const inventoryNow = await decisionInventory();
      const mutation = validateStagedInputMutation({
        value: body,
        now: new Date().toISOString(),
        inventory: inventoryNow,
      });
      const inputs = applyStagedInputMutation({
        inputs: await readAnswers(),
        mutation,
      });
      await writeStagedInputs({ store, inputs });
      sendJson({
        response,
        status: 200,
        value: encodeReviewState({
          answers: currentAnswers({ inputs, inventory: inventoryNow }),
          supersededDecisionIds: supersededDecisionIds({
            inputs,
            inventory: inventoryNow,
          }),
          revision: inputs.revision,
        }),
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
      const imageReferences = imageReferencesForBodies(
        newlySent.map((comment) => comment.body),
      );
      if (imageReferences.length > MAX_IMAGES_PER_MESSAGE) {
        refuse({
          response,
          status: 400,
          reason: `A message can contain at most ${MAX_IMAGES_PER_MESSAGE} images`,
        });
        return;
      }
      const storedSubmission = await readFeedbackSubmissionValue({
        store,
        submissionId,
      });
      let submission: FeedbackSubmission;
      if (storedSubmission === undefined) {
        let attachments;
        try {
          attachments = await freezeRequestAttachments({
            store,
            requestId: submissionId,
            references: imageReferences,
          });
        } catch (error: unknown) {
          refuse({
            response,
            status: 400,
            reason:
              error instanceof Error
                ? error.message
                : "An image could not be attached",
          });
          return;
        }
        if (
          attachments.reduce(
            (total, attachment) => total + attachment.byteLength,
            0,
          ) > MAX_MESSAGE_IMAGE_BYTES
        ) {
          refuse({
            response,
            status: 400,
            reason: "Images in one message exceed the 20 MiB limit",
          });
          return;
        }
        const source = await readFile(resolvedPlanPath, "utf8");
        const premiseSnapshot = deriveSnapshotDigest(source);
        const feedback = buildFeedbackPackage({
          sessionId,
          packageId: submissionId,
          planId,
          planPath: resolvedPlanPath,
          createdAt: new Date().toISOString(),
          comments: newlySent,
          attachments,
        });
        submission = {
          version: 2,
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
    if (route.path === "/api/revert-agent-changes") {
      const payload =
        typeof body === "object" && body !== null
          ? (body as Readonly<Record<string, unknown>>)
          : {};
      const requestId = payload.requestId;
      const commentId = payload.commentId;
      if (typeof requestId !== "string" || typeof commentId !== "string") {
        refuse({
          response,
          status: 400,
          reason: "A request id and comment id are required",
        });
        return;
      }
      const exchange = await readAgentCommentHistory({
        store,
        sessionId,
        planId,
        commentId,
      });
      const request = exchange.requests.find(
        (candidate) => candidate.requestId === requestId,
      );
      const agentResponse = exchange.responses.find(
        (candidate) => candidate.requestId === requestId,
      );
      const changedOutcome =
        agentResponse?.kind === "chat"
          ? undefined
          : agentResponse?.outcomes.find(
              (outcome) =>
                outcome.commentId === commentId && outcome.state === "changed",
            );
      if (
        request === undefined ||
        request.baselineSnapshot === undefined ||
        agentResponse === undefined ||
        changedOutcome === undefined
      ) {
        refuse({
          response,
          status: 404,
          reason: "No reversible agent response exists for this comment",
        });
        return;
      }
      const currentSource = await readFile(resolvedPlanPath, "utf8");
      if (
        deriveSnapshotDigest(currentSource) !== agentResponse.resultSnapshot
      ) {
        refuse({
          response,
          status: 409,
          reason:
            "The plan changed after this response, so reverting it would overwrite newer work",
        });
        return;
      }
      let baselineSource: string;
      try {
        baselineSource = await readSnapshot({
          store,
          snapshot: request.baselineSnapshot,
        });
      } catch {
        refuse({
          response,
          status: 404,
          reason: "The response baseline is no longer available",
        });
        return;
      }
      renderDocument({
        markdown: baselineSource,
        fallbackTitle: basename(resolvedPlanPath, extname(resolvedPlanPath)),
        identity: {},
      });
      await replacePlanSource({
        path: resolvedPlanPath,
        source: baselineSource,
      });
      acceptedSnapshot = request.baselineSnapshot;
      sendJson({
        response,
        status: 200,
        value: {
          requestId,
          commentId,
          currentSnapshot: request.baselineSnapshot,
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
      const currentSnapshot = deriveSnapshotDigest(
        await readFile(resolvedPlanPath, "utf8"),
      );
      const revertedAnsweredRequestIds = new Set(
        exchange.requests.flatMap((candidate) =>
          candidate.baselineSnapshot === currentSnapshot &&
          answeredRequestIds.has(candidate.requestId)
            ? [candidate.requestId]
            : [],
        ),
      );
      const revertedChangedResponse = exchange.responses.some(
        (candidate) =>
          candidate.kind !== "chat" &&
          revertedAnsweredRequestIds.has(candidate.requestId) &&
          candidate.outcomes.some(
            (outcome) =>
              outcome.commentId === commentId && outcome.state === "changed",
          ),
      );
      const commentRequests = exchange.requests;
      if (
        (answeredRequestIds.size > 0 && !revertedChangedResponse) ||
        commentRequests.length === 0
      ) {
        refuse({
          response,
          status: 409,
          reason:
            "Only a queued, canceled, or reverted comment can be deleted from the review",
        });
        return;
      }
      if (
        answeredRequestIds.size === 0 &&
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
      if (
        answeredRequestIds.size > 0 &&
        pendingRequests.some(
          (candidate) => !answeredRequestIds.has(candidate.requestId),
        )
      ) {
        refuse({
          response,
          status: 409,
          reason: "A follow-up is still pending for this comment",
        });
        return;
      }
      const now = new Date().toISOString();
      for (const pending of answeredRequestIds.size === 0
        ? pendingRequests
        : []) {
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
      const requestId = randomId(8);
      const imageReferences = imageReferencesForBodies([messageBody]);
      if (imageReferences.length > MAX_IMAGES_PER_MESSAGE) {
        refuse({
          response,
          status: 400,
          reason: `A message can contain at most ${MAX_IMAGES_PER_MESSAGE} images`,
        });
        return;
      }
      let attachments;
      try {
        attachments = await freezeRequestAttachments({
          store,
          requestId,
          references: imageReferences,
        });
      } catch (error: unknown) {
        refuse({
          response,
          status: 400,
          reason:
            error instanceof Error
              ? error.message
              : "An image could not be attached",
        });
        return;
      }
      if (
        attachments.reduce(
          (total, attachment) => total + attachment.byteLength,
          0,
        ) > MAX_MESSAGE_IMAGE_BYTES
      ) {
        refuse({
          response,
          status: 400,
          reason: "Images in one message exceed the 20 MiB limit",
        });
        return;
      }
      const agentRequest = messageAgentRequest({
        kind,
        requestId,
        sessionId,
        planId,
        premiseSnapshot,
        createdAt: new Date().toISOString(),
        body: messageBody,
        attachments,
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
      const snapshotDiff = buildSnapshotDiff({
        from,
        to,
        before: before.blocks,
        after: after.blocks,
      });
      sendJson({
        response,
        status: 200,
        value: encodeSnapshotDiff({
          ...snapshotDiff,
          locations: snapshotDiff.locations.map((location) =>
            usesRenderedSnapshot(location)
              ? (() => {
                  const oldHtml = renderedBlockHtml({
                    html: before.html,
                    blockId: location.oldBlockId,
                    namespace: `was-${from}`,
                  });
                  const newHtml = renderedBlockHtml({
                    html: after.html,
                    blockId: location.newBlockId,
                    namespace: `now-${to}`,
                  });
                  return {
                    ...location,
                    ...(oldHtml === undefined ? {} : { oldHtml }),
                    ...(newHtml === undefined ? {} : { newHtml }),
                  };
                })()
              : location,
          ),
        }),
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

  let lastReviewActivityAt = Date.now();
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
        lastReviewActivityAt = Date.now();
        await handleDocument(response);
        return;
      }
      if (
        method === DOCUMENT_ROUTE.method &&
        (await handlePlanAsset({ response, pathname: target.pathname }))
      ) {
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
      const binaryBody =
        matched.binary === true ? await readBinaryBody(request) : undefined;
      const body =
        matched.method === "GET" || matched.binary === true
          ? undefined
          : await readBody(request);
      const dispatch = () =>
        handleApi({
          route: matched,
          response,
          query: target.searchParams,
          body,
          binaryBody,
        });
      if (matched.method === "GET") {
        await dispatch();
      } else {
        await exclusively(async () => {
          const authority = await withReviewSessionAuthority({
            store,
            sessionId,
            change: async () => {
              lastReviewActivityAt = Date.now();
              await dispatch();
            },
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
      if (
        error instanceof CommentRejected ||
        error instanceof PlanInputsRejected
      ) {
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

  let closed = false;
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  const closeRuntime = async (
    reason = "The review session was stopped.",
  ): Promise<void> => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeatTimer);
    clearInterval(connectionTimer);
    if (idleTimer !== undefined) clearInterval(idleTimer);
    await queueHeartbeat(false, reason).catch(() => undefined);
    await connectionWrite.catch(() => undefined);
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
  if (idleTimeoutMs > 0) {
    idleTimer = setInterval(
      () => {
        void (async () => {
          if (closed || Date.now() - lastReviewActivityAt < idleTimeoutMs)
            return;
          const presence = await readAgentPresence({ store, sessionId });
          if (presence.connected && presence.state === "working") {
            lastReviewActivityAt = Date.now();
            return;
          }
          const minutes = idleTimeoutMs / 60_000;
          const duration = Number.isInteger(minutes)
            ? `${minutes} minute${minutes === 1 ? "" : "s"}`
            : (() => {
                const seconds = Math.round(idleTimeoutMs / 1_000);
                return `${seconds} second${seconds === 1 ? "" : "s"}`;
              })();
          await closeRuntime(
            `The review session ended normally after ${duration} of inactivity.`,
          );
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
    close: closeRuntime,
  };
};
