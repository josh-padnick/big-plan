// The routes that own the reviewer's own state: the drafts being written, the
// comments sent to the agent, the deletions applied to them, and the revert
// that puts the plan back to the baseline a response was built on.
//
// Reviewer-state mutations are conditional. A state read carries the version
// of the content it came from, and each mutation must carry the version it was
// prepared against; one prepared against content the store has since moved
// past is refused rather than applied.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  assertCommentsAreUnresolved,
  assertRequestsMayBeTakenBack,
  assertResolvableComment,
  cancelAgentRequest,
  ensureAgentRequest,
  removeCommentFromQueuedFeedbackRequest,
  withResolvedCommentLock,
} from "./request-mailbox.js";
import {
  REVERT_SOURCE_MOVED_REASON,
  revertPlanSource,
  settleInterruptedCommitsFor,
} from "./staged-plan-mutation.js";
import {
  acceptOpenPlaces,
  restoreOpenPlaces,
  type AcceptedOpenPlaces,
} from "./change-set-closure.js";
import { closuresForResolvedThreads } from "./resolved-thread-acceptance.js";
import { settlementRefusal } from "./review-route-settlement.js";
import { threadChangesAllDecided } from "./thread-changes-decided.js";
import {
  anchorReviewStore,
  freezeRequestAttachments,
  readAgentPresence,
  readFeedbackSubmissionValue,
  readResolvedCommentIds,
  readSnapshot,
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
import { agentStillOwnsRequest } from "./shared/request-ownership.js";
import { reviewStateVersion } from "./review-state-version.js";
import {
  encodeReviewSnapshot,
  STALE_REVIEW_STATE_CODE,
} from "./shared/review-wire.js";

const readStoredReviewerState = async ({
  context,
  store = context.store,
}: {
  readonly context: ReviewRouteContext;
  readonly store?: ReviewRouteContext["store"];
}) => {
  const drafts = await context.planRenderer.readStoredComments(
    store.draftsPath,
  );
  const resolvedCommentIds = await readResolvedCommentIds({
    store,
    validate: validateResolvedCommentIds,
  });
  return {
    drafts,
    resolvedCommentIds,
    version: reviewStateVersion({ drafts, resolvedCommentIds }),
  };
};

const storedReviewSnapshot = async ({
  context,
  store = context.store,
}: {
  readonly context: ReviewRouteContext;
  readonly store?: ReviewRouteContext["store"];
}) => {
  const reviewerState = await readStoredReviewerState({ context, store });
  return encodeReviewSnapshot({
    ...reviewerState,
    sent: await context.planRenderer.readStoredComments(store.sentPath),
  });
};

const conditionalReviewStateRefusal = async ({
  context,
  store = context.store,
  payload,
  operation,
}: {
  readonly context: ReviewRouteContext;
  readonly store?: ReviewRouteContext["store"];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly operation: string;
}): Promise<ReviewRouteResponse | undefined> => {
  if (typeof payload.version !== "string" || payload.version === "") {
    return refusal({
      status: 400,
      reason: `${operation} must carry the review-state version it was prepared against`,
    });
  }
  const { version } = await readStoredReviewerState({ context, store });
  return payload.version === version
    ? undefined
    : refusal({
        status: 409,
        reason: "The review state changed since this mutation was prepared",
        code: STALE_REVIEW_STATE_CODE,
      });
};

type FeedbackSubmission = {
  readonly version: 2;
  readonly submissionId: string;
  readonly feedback: FeedbackPackage;
  readonly source: string;
  readonly premiseSnapshot: string;
};

// One submission carries a set of comments, not a sequence, so a retry that
// sends the same comments in a different order has to reach the same stored
// submission instead of duplicating the artifacts and the agent request.
export const canonicalSubmissionComments = (
  comments: ReadonlyArray<ReviewComment>,
): ReadonlyArray<{
  readonly id: string;
  readonly body: string;
  readonly premiseSnapshot: string;
  readonly target: ReviewComment["target"];
}> =>
  [...comments]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, body, premiseSnapshot, target }) => ({
      id,
      body,
      premiseSnapshot,
      target,
    }));

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
        comments: canonicalSubmissionComments(comments),
      }),
    )
    .digest("hex")
    .slice(0, 16);

const feedbackSubmissionContent = (
  comments: ReadonlyArray<ReviewComment>,
): string => JSON.stringify(canonicalSubmissionComments(comments));

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
  const { planRenderer } = context;
  // The document must exist before drafts can be resolved, because the
  // block map is what makes a stored target meaningful.
  await planRenderer.renderPlan();
  return jsonResponse({
    status: 200,
    value: await storedReviewSnapshot({ context }),
  });
};

/** Stores the reviewer's unsent work; a draft already sent is not a draft. */
export const updateReviewState = async (
  context: ReviewRouteContext,
  { body }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { store, planId, sessionId, resolvedPlanPath, planRenderer } = context;
  const payload = payloadOf(body);
  const versionRefusal = await conditionalReviewStateRefusal({
    context,
    payload,
    operation: "A drafts write",
  });
  if (versionRefusal !== undefined) return versionRefusal;
  const drafts = await planRenderer.validateUpdates(payload.drafts);
  const resolvedCommentIds = validateResolvedCommentIds(
    payload.resolvedCommentIds,
  );
  // A newly resolved thread must not contradict outstanding agent work. The
  // check and the resolved-id write share `.resolved.lock` with request
  // creation, so a refusal leaves the whole review state untouched and a
  // concurrent create cannot sneak onto the thread.
  try {
    const lockedVersionRefusal = await withResolvedCommentLock({
      store,
      change: async (lockedStore) => {
        const refusal = await conditionalReviewStateRefusal({
          context,
          store: lockedStore,
          payload,
          operation: "A drafts write",
        });
        if (refusal !== undefined) return refusal;
        const alreadyResolved = new Set(
          await readResolvedCommentIds({
            store: lockedStore,
            validate: validateResolvedCommentIds,
          }),
        );
        const newlyResolved: Array<string> = [];
        for (const commentId of resolvedCommentIds) {
          if (alreadyResolved.has(commentId)) continue;
          await assertResolvableComment({
            store: lockedStore,
            sessionId,
            planId,
            commentId,
          });
          newlyResolved.push(commentId);
        }
        // Resolving answers the changes the thread left open, and it does so
        // before the thread is recorded as resolved: a reviewer never sees a
        // closed thread that still owes an answer, and a repeat of this write
        // re-selects nothing because the places are decided by then.
        const closures = await closuresForResolvedThreads({
          store: lockedStore,
          planPath: resolvedPlanPath,
          sessionId,
          planId,
          commentIds: newlyResolved,
        });
        let acceptance: AcceptedOpenPlaces | undefined;
        if (closures.length > 0) {
          acceptance = await acceptOpenPlaces({
            store: lockedStore,
            closures,
            decidedAt: new Date().toISOString(),
          });
        }
        try {
          const sentIds = new Set(
            (await planRenderer.readStoredComments(lockedStore.sentPath)).map(
              (comment) => comment.id,
            ),
          );
          const unsentDrafts = drafts.filter((draft) => !sentIds.has(draft.id));
          await writeComments({
            path: lockedStore.draftsPath,
            comments: unsentDrafts,
          });
          await writeResolvedCommentIds({
            store: lockedStore,
            ids: resolvedCommentIds,
          });
        } catch (error: unknown) {
          if (acceptance !== undefined) {
            await restoreOpenPlaces({ store: lockedStore, acceptance });
          }
          throw error;
        }
        return undefined;
      },
    });
    if (lockedVersionRefusal !== undefined) return lockedVersionRefusal;
  } catch (error: unknown) {
    if (!(error instanceof AgentExchangeRejected)) throw error;
    return refusal({ status: 409, reason: error.message });
  }
  return jsonResponse({
    status: 200,
    value: await storedReviewSnapshot({ context }),
  });
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
  const { planId, sessionId, resolvedPlanPath, planRenderer } = context;
  let { store } = context;
  const payload = payloadOf(body);
  store = await (await anchorReviewStore(store)).resolveStore();
  const versionRefusal = await conditionalReviewStateRefusal({
    context,
    store,
    payload,
    operation: "A feedback submission",
  });
  if (versionRefusal !== undefined) return versionRefusal;
  // Read the existing comments through the anchored store, not the one the
  // renderer was built with, so a symlinked review directory cannot redirect
  // them outside the chain this route just anchored.
  const comments = await planRenderer.validateUpdates(payload.comments, store);
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
  // The refusal is defined for new work, so it is asked of new work only. A
  // resend of something already sent is the retry this route answers with 200,
  // and refusing it would make a retry harder to complete than the first try.
  try {
    await assertCommentsAreUnresolved({
      store,
      commentIds: newlySent.map((comment) => comment.id),
    });
  } catch (error: unknown) {
    if (!(error instanceof AgentExchangeRejected)) throw error;
    return refusal({ status: 409, reason: error.message });
  }
  const submittedIds = new Set(comments.map((comment) => comment.id));
  const remainingDrafts = (
    await planRenderer.readStoredComments(store.draftsPath)
  ).filter((comment) => !submittedIds.has(comment.id));
  if (newlySent.length === 0) {
    await writeComments({
      path: store.draftsPath,
      comments: remainingDrafts,
    });
    return jsonResponse({
      status: 200,
      value: {
        comments: 0,
        retried: true,
        ...(await storedReviewSnapshot({ context, store })),
      },
    });
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
        totalByteLimit: MAX_MESSAGE_IMAGE_BYTES,
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
  let agentRequest;
  try {
    agentRequest = await ensureAgentRequest({
      store,
      request: feedbackAgentRequest({
        feedback,
        premiseSnapshot,
      }),
    });
  } catch (error: unknown) {
    if (!(error instanceof AgentExchangeRejected)) throw error;
    return refusal({ status: 409, reason: error.message });
  }
  await writeComments({
    path: store.sentPath,
    comments: [...alreadySent, ...feedback.comments],
  });
  await writeComments({
    path: store.draftsPath,
    comments: remainingDrafts,
  });
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
      ...(await storedReviewSnapshot({ context, store })),
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
    agentResponse?.kind === "chat" || agentResponse?.kind === "approval"
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
    return refusal({ status: 409, reason: REVERT_SOURCE_MOVED_REASON });
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
  // Everything above was decided outside the plan-mutation lock, so the same
  // digest is proved again under it. An agent commit that published from this
  // response's result in the meantime wins, and the reviewer is told rather
  // than losing that revision to a rename it never saw.
  try {
    await revertPlanSource({
      store,
      planPath: resolvedPlanPath,
      expectedSnapshot: agentResponse.resultSnapshot,
      source: baselineSource,
    });
  } catch (error: unknown) {
    return settlementRefusal(error);
  }
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
  const versionRefusal = await conditionalReviewStateRefusal({
    context,
    payload,
    operation: "A comment deletion",
  });
  if (versionRefusal !== undefined) return versionRefusal;
  const commentId = payload.commentId;
  if (typeof commentId !== "string") {
    return refusal({ status: 400, reason: "A comment id is required" });
  }
  const sent = await planRenderer.readStoredComments(store.sentPath);
  if (!sent.some((comment) => comment.id === commentId)) {
    return refusal({ status: 404, reason: "No such sent comment" });
  }
  const commentHistory = () =>
    readAgentCommentHistory({ store, sessionId, planId, commentId });
  // An interrupted commit is settled before anything below decides anything,
  // so the journal guards refuse only an answer that really is published or
  // one rename away from it, never one an abandoned commit left in its own
  // stage - which would relock exactly the comment an abandoned claim hands
  // back (BIG-120). Settling can stamp a request terminal, so every decision
  // that follows is made from a read taken after it.
  const initialExchange = await commentHistory();
  let settled: boolean;
  try {
    settled = await settleInterruptedCommitsFor({
      store,
      planPath: resolvedPlanPath,
      requestIds: initialExchange.requests.map(
        (candidate) => candidate.requestId,
      ),
    });
  } catch (error: unknown) {
    return settlementRefusal(error);
  }
  const exchange = settled ? await commentHistory() : initialExchange;
  const answeredRequestIds = new Set(
    exchange.responses.flatMap((candidate) =>
      candidate.kind !== "chat" &&
      candidate.kind !== "approval" &&
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
      candidate.kind !== "approval" &&
      revertedAnsweredRequestIds.has(candidate.requestId) &&
      candidate.outcomes.some(
        (outcome) =>
          outcome.commentId === commentId && outcome.state === "changed",
      ),
  );
  const commentRequests = exchange.requests;
  // A thread that changed the plan may be deleted once the reviewer has
  // answered every change it proposed - accepted ones stay in the plan,
  // rejected ones are already back out of it. What may not be deleted is a
  // thread still holding a change nobody decided, because that would strand
  // the change with nothing left on screen to explain or undo it.
  const changesAllDecided =
    answeredRequestIds.size === 0 || revertedChangedResponse
      ? false
      : await threadChangesAllDecided({
          store,
          planPath: resolvedPlanPath,
          changeSetId: commentId,
          verdicts: await context.changeVerdicts.read(),
        });
  if (
    (answeredRequestIds.size > 0 &&
      !revertedChangedResponse &&
      !changesAllDecided) ||
    commentRequests.length === 0
  ) {
    return refusal({
      status: 409,
      reason:
        "Only a queued or canceled comment, or a thread whose changes are all decided, can be deleted from the review",
    });
  }
  // Pickup locks the comment only while the claim on it still means something.
  // A claim proven abandoned - nothing attached, and quiet past the recovery
  // horizon - releases the comment back to the reviewer, on the same rule the
  // browser used to decide whether to offer delete at all (BIG-120).
  const agentConnected = (await readAgentPresence({ store, sessionId }))
    .connected;
  const deletionNowMs = Date.now();
  if (
    answeredRequestIds.size === 0 &&
    commentRequests.some((candidate) =>
      agentStillOwnsRequest({
        request: candidate,
        agentConnected,
        nowMs: deletionNowMs,
      }),
    )
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
  const wasResolved = (
    await readResolvedCommentIds({
      store,
      validate: validateResolvedCommentIds,
    })
  ).includes(commentId);
  const takenBack = answeredRequestIds.size === 0 ? pendingRequests : [];
  // Every request that carries this comment is proved take-backable before any
  // of them is written, so a refusal partway through cannot leave the earlier
  // ones withdrawn for a deletion that never happened.
  //
  // The catch around the loop stays, because the proof is not a lock: the
  // request locks are taken one at a time, so an agent claiming between the
  // proof and the write can still refuse here. That removes the deterministic
  // case this route's own settle step caused, not cross-process racing. Either
  // way the refusal is the reviewer's answer rather than a runtime failure, so
  // the comment stays and the conflict is reported.
  try {
    await assertRequestsMayBeTakenBack({
      store,
      requestIds: takenBack.map((pending) => pending.requestId),
      agentConnected,
    });
    for (const pending of takenBack) {
      if (pending.canceledAt !== undefined) continue;
      if (pending.kind === "feedback") {
        await removeCommentFromQueuedFeedbackRequest({
          store,
          requestId: pending.requestId,
          commentId,
          now,
          agentConnected,
        });
      } else {
        await cancelAgentRequest({
          store,
          requestId: pending.requestId,
          now,
        });
      }
    }
  } catch (error: unknown) {
    if (!(error instanceof AgentExchangeRejected)) throw error;
    return refusal({ status: 409, reason: error.message });
  }
  // The resolved-id read-modify-write shares `.resolved.lock` with request
  // creation and the drafts write, so a concurrent resolve cannot be dropped by
  // this deletion. The request locks above are already released, keeping the
  // request-then-resolved order `ensureAgentRequest` establishes. A comment
  // that was not resolved has no id to remove, and a comment holding queued
  // work is never resolved, so this waits on the lock only when it writes.
  if (wasResolved) {
    try {
      await withResolvedCommentLock({
        store,
        change: async (lockedStore) => {
          const resolvedCommentIds = await readResolvedCommentIds({
            store: lockedStore,
            validate: validateResolvedCommentIds,
          });
          await writeResolvedCommentIds({
            store: lockedStore,
            ids: resolvedCommentIds.filter((id) => id !== commentId),
          });
        },
      });
    } catch (error: unknown) {
      if (!(error instanceof AgentExchangeRejected)) throw error;
      return refusal({ status: 409, reason: error.message });
    }
  }
  await writeComments({
    path: store.sentPath,
    comments: sent.filter((comment) => comment.id !== commentId),
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
  return jsonResponse({
    status: 200,
    value: { commentId, ...(await storedReviewSnapshot({ context })) },
  });
};
