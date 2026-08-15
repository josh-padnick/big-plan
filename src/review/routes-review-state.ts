// The routes that own the reviewer's own state: the drafts being written, the
// comments sent to the agent, the deletions applied to them, and the revert
// that puts the plan back to the baseline a response was built on.

import { createHash, randomBytes } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { renderDocument } from "../render/render-document.js";
import { jsonResponse, payloadOf, refusal } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteRequest,
  ReviewRouteResponse,
} from "./review-route-context.js";
import type { ReviewComment } from "./shared/comment.js";
import {
  validateActiveDraft,
  validateResolvedCommentIds,
  validateStoredComments,
} from "./shared/comment.js";
import { buildFeedbackPackage, renderBrief } from "./feedback-package.js";
import type { FeedbackPackage } from "./feedback-package.js";
import {
  AgentExchangeRejected,
  deriveSnapshotDigest,
  feedbackAgentRequest,
  readAgentCommentHistory,
  validateAgentRequest,
} from "./agent-exchange.js";
import {
  appendProgressEvent,
  assertResolvableComment,
  cancelAgentRequest,
  ensureAgentRequest,
  removeCommentFromQueuedFeedbackRequest,
} from "./request-mailbox.js";
import {
  freezeRequestAttachments,
  readActiveDraft,
  readFeedbackSubmissionValue,
  readResolvedCommentIds,
  readSnapshot,
  writeActiveDraft,
  writeComments,
  writeFeedbackPackage,
  writeFeedbackSubmissionValue,
  writeResolvedCommentIds,
  writeSnapshot,
} from "./store.js";
import {
  imageReferencesForBodies,
  MAX_IMAGES_PER_MESSAGE,
  MAX_MESSAGE_IMAGE_BYTES,
} from "./shared/review-image.js";
import { encodeReviewSnapshot } from "./shared/review-wire.js";

/**
 * Replaces the plan through a same-directory temporary file so a reader never
 * observes a partially written plan, and the original mode survives.
 */
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

type FeedbackSubmission = {
  readonly version: 2;
  readonly submissionId: string;
  readonly feedback: FeedbackPackage;
  readonly source: string;
  readonly premiseSnapshot: string;
};

// A submission is identified by what it says, not when it was sent, so a retry
// of the same comments resolves to the same package instead of a second one.
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

/**
 * Validates a previously stored submission and proves it describes this same
 * retry, so resending identical comments republishes one package rather than
 * inventing a second one from partially trusted stored state.
 */
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

export const readReviewState = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const { store, planRenderer } = context;
  // The document must exist before drafts can be resolved, because the
  // block map is what makes a stored target meaningful.
  await planRenderer.renderPlan();
  return jsonResponse({
    status: 200,
    value: encodeReviewSnapshot({
      drafts: await planRenderer.readStoredComments(store.draftsPath),
      sent: await planRenderer.readStoredComments(store.sentPath),
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
};

/** Stores the reviewer's unsent work; a draft already sent is not a draft. */
export const updateReviewState = async (
  context: ReviewRouteContext,
  { body }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { store, planId, sessionId, planRenderer } = context;
  const payload = payloadOf(body);
  const drafts = await planRenderer.validateUpdates(payload.drafts);
  const activeDraft = validateActiveDraft(payload.activeDraft);
  const resolvedCommentIds = validateResolvedCommentIds(
    payload.resolvedCommentIds,
  );
  // A newly resolved thread must not contradict outstanding agent work. The
  // check runs before any write, so a refusal leaves the whole review state
  // untouched rather than half applied.
  const alreadyResolved = new Set(
    await readResolvedCommentIds({
      store,
      validate: validateResolvedCommentIds,
    }),
  );
  for (const commentId of resolvedCommentIds) {
    if (alreadyResolved.has(commentId)) continue;
    try {
      await assertResolvableComment({ store, sessionId, planId, commentId });
    } catch (error: unknown) {
      if (!(error instanceof AgentExchangeRejected)) throw error;
      return refusal({ status: 409, reason: error.message });
    }
  }
  const sentIds = new Set(
    (await planRenderer.readStoredComments(store.sentPath)).map(
      (comment) => comment.id,
    ),
  );
  const unsentDrafts = drafts.filter((draft) => !sentIds.has(draft.id));
  await writeComments({ path: store.draftsPath, comments: unsentDrafts });
  await writeActiveDraft({
    path: store.activeDraftPath,
    value: activeDraft,
  });
  await writeResolvedCommentIds({ store, ids: resolvedCommentIds });
  return jsonResponse({ status: 200, value: { drafts: unsentDrafts.length } });
};

/**
 * Publishes the feedback package for the comments being sent. A resend of the
 * same comments is a retry, not a second package, so the submission is written
 * under a content-derived id and reused when it is already there.
 */
export const submitFeedback = async (
  context: ReviewRouteContext,
  { body }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { store, planId, sessionId, resolvedPlanPath, planRenderer } = context;
  const payload = payloadOf(body);
  const comments = await planRenderer.validateUpdates(payload.comments);
  if (comments.length === 0) {
    return refusal({ status: 400, reason: "Nothing to send" });
  }
  const alreadySent = await planRenderer.readStoredComments(store.sentPath);
  const sentById = new Map(alreadySent.map((comment) => [comment.id, comment]));
  if (
    comments.some((comment) => {
      const existing = sentById.get(comment.id);
      return (
        existing !== undefined &&
        JSON.stringify(existing) !== JSON.stringify(comment)
      );
    })
  ) {
    return refusal({
      status: 409,
      reason: "A sent comment id cannot be reused for different feedback",
    });
  }
  const newlySent = comments.filter((comment) => !sentById.has(comment.id));
  const submittedIds = new Set(comments.map((comment) => comment.id));
  const remainingDrafts = (
    await planRenderer.readStoredComments(store.draftsPath)
  ).filter((comment) => !submittedIds.has(comment.id));
  if (newlySent.length === 0) {
    await writeComments({
      path: store.draftsPath,
      comments: remainingDrafts,
    });
    await writeActiveDraft({ path: store.activeDraftPath, value: "" });
    return jsonResponse({ status: 200, value: { comments: 0, retried: true } });
  }
  const submissionId = feedbackSubmissionId({
    planId,
    comments: newlySent,
  });
  const imageReferences = imageReferencesForBodies(
    newlySent.map((comment) => comment.body),
  );
  if (imageReferences.length > MAX_IMAGES_PER_MESSAGE) {
    return refusal({
      status: 400,
      reason: `A message can contain at most ${MAX_IMAGES_PER_MESSAGE} images`,
    });
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
      return refusal({
        status: 400,
        reason:
          error instanceof Error
            ? error.message
            : "An image could not be attached",
      });
    }
    if (
      attachments.reduce(
        (total, attachment) => total + attachment.byteLength,
        0,
      ) > MAX_MESSAGE_IMAGE_BYTES
    ) {
      return refusal({
        status: 400,
        reason: "Images in one message exceed the 20 MiB limit",
      });
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
  return jsonResponse({
    status: 200,
    value: {
      packageId: feedback.packageId,
      comments: newlySent.length,
      package: written.jsonPath,
      brief: written.briefPath,
      agentRequest,
    },
  });
};

/**
 * Puts the plan back to the baseline one answered response was built on, and
 * refuses when newer work has landed since, because reverting would silently
 * overwrite it.
 */
export const revertAgentChanges = async (
  context: ReviewRouteContext,
  { body }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { store, planId, sessionId, resolvedPlanPath, readerProgress } =
    context;
  const payload = payloadOf(body);
  const requestId = payload.requestId;
  const commentId = payload.commentId;
  if (typeof requestId !== "string" || typeof commentId !== "string") {
    return refusal({
      status: 400,
      reason: "A request id and comment id are required",
    });
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
    return refusal({
      status: 404,
      reason: "No reversible agent response exists for this comment",
    });
  }
  const currentSource = await readFile(resolvedPlanPath, "utf8");
  if (deriveSnapshotDigest(currentSource) !== agentResponse.resultSnapshot) {
    return refusal({
      status: 409,
      reason:
        "The plan changed after this response, so reverting it would overwrite newer work",
    });
  }
  let baselineSource: string;
  try {
    baselineSource = await readSnapshot({
      store,
      snapshot: request.baselineSnapshot,
    });
  } catch {
    return refusal({
      status: 404,
      reason: "The response baseline is no longer available",
    });
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
  readerProgress.accept(request.baselineSnapshot);
  return jsonResponse({
    status: 200,
    value: {
      requestId,
      commentId,
      currentSnapshot: request.baselineSnapshot,
    },
  });
};

/**
 * Removes a sent comment from the review. Only a comment the agent has not
 * acted on, or whose one change has since been reverted, can go: anything else
 * would leave the plan carrying work whose reason has disappeared.
 */
export const deleteSentComment = async (
  context: ReviewRouteContext,
  { body }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { store, planId, sessionId, resolvedPlanPath, planRenderer } = context;
  const payload = payloadOf(body);
  const commentId = payload.commentId;
  if (typeof commentId !== "string") {
    return refusal({ status: 400, reason: "A comment id is required" });
  }
  const sent = await planRenderer.readStoredComments(store.sentPath);
  if (!sent.some((comment) => comment.id === commentId)) {
    return refusal({ status: 404, reason: "No such sent comment" });
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
    return refusal({
      status: 409,
      reason:
        "Only a queued, canceled, or reverted comment can be deleted from the review",
    });
  }
  if (
    answeredRequestIds.size === 0 &&
    commentRequests.some((candidate) => candidate.claimedAt !== undefined)
  ) {
    return refusal({
      status: 409,
      reason: "The agent has already picked up this comment",
    });
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
    return refusal({
      status: 409,
      reason: "A follow-up is still pending for this comment",
    });
  }
  const now = new Date().toISOString();
  for (const pending of answeredRequestIds.size === 0 ? pendingRequests : []) {
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
  return jsonResponse({ status: 200, value: { commentId } });
};
