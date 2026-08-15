// The routes that carry the conversation with the agent: the exchange the
// browser polls, and the progress events the runtime and the agent append to
// it.

import { readFile } from "node:fs/promises";
import { jsonResponse, payloadOf, refusal } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteRequest,
  ReviewRouteResponse,
} from "./review-route-context.js";
import {
  AgentExchangeRejected,
  deriveSnapshotDigest,
  messageAgentRequest,
  readAgentExchange,
  writeAgentRequest,
} from "./agent-exchange.js";
import { appendProgressEvent, cancelAgentRequest } from "./request-mailbox.js";
import {
  freezeRequestAttachments,
  randomId,
  readAgentConnectionEvents,
  readAgentPresence,
  readProgress,
  writeSnapshot,
} from "./store.js";
import {
  imageReferencesForBodies,
  MAX_IMAGES_PER_MESSAGE,
  MAX_MESSAGE_IMAGE_BYTES,
} from "./shared/review-image.js";
import { encodeAgentSnapshot, encodeProgress } from "./shared/review-wire.js";

/**
 * Reading the exchange is also how the runtime learns that a response arrived,
 * so it advances reader progress before answering.
 */
export const readAgentSnapshot = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const { store, sessionId, planId, readerProgress } = context;
  const exchange = await readAgentExchange({ store, sessionId, planId });
  for (const agentResponse of exchange.responses) {
    readerProgress.observe(agentResponse);
  }
  const presence = await readAgentPresence({ store, sessionId });
  const connectionLog = await readAgentConnectionEvents({ store, sessionId });
  return jsonResponse({
    status: 200,
    value: encodeAgentSnapshot({
      // The browser reloads only revisions the response command has
      // rendered, linted, and accepted. Watching the raw file here would
      // navigate the reviewer onto a transient parse error while an agent
      // is midway through editing the authoritative MDX.
      currentSnapshot: readerProgress.currentSnapshot(),
      presence,
      connectionLog,
      plan: context.resolvedPlanPath,
      agentCommand: context.agentCommand,
      recoveryPrompt: context.recoveryPrompt,
      requests: exchange.requests,
      responses: exchange.responses,
    }),
  });
};

export const readProgressEvents = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const events = await readProgress({
    store: context.store,
    sessionId: context.sessionId,
  });
  return jsonResponse({ status: 200, value: encodeProgress({ events }) });
};

/**
 * Queues one reply or plan question for the agent. The plan as it stands right
 * now becomes the request's premise, so the agent can tell what the reviewer
 * was looking at when they wrote it.
 */
export const sendAgentRequest = async (
  context: ReviewRouteContext,
  { body }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { store, planId, sessionId, resolvedPlanPath, planRenderer } = context;
  const payload = payloadOf(body);
  const kind = payload.kind;
  if (kind !== "reply" && kind !== "chat") {
    return refusal({
      status: 400,
      reason: 'An agent request kind must be "reply" or "chat"',
    });
  }
  const messageBody =
    typeof payload.body === "string" ? payload.body.trim() : "";
  if (messageBody === "") {
    return refusal({ status: 400, reason: "An agent request needs a body" });
  }
  const source = await readFile(resolvedPlanPath, "utf8");
  const premiseSnapshot = deriveSnapshotDigest(source);
  await writeSnapshot({ store, snapshot: premiseSnapshot, source });
  const requestId = randomId(8);
  const imageReferences = imageReferencesForBodies([messageBody]);
  if (imageReferences.length > MAX_IMAGES_PER_MESSAGE) {
    return refusal({
      status: 400,
      reason: `A message can contain at most ${MAX_IMAGES_PER_MESSAGE} images`,
    });
  }
  let attachments;
  try {
    attachments = await freezeRequestAttachments({
      store,
      requestId,
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
    const sent = await planRenderer.readStoredComments(store.sentPath);
    if (!sent.some((comment) => comment.id === agentRequest.commentId)) {
      return refusal({
        status: 400,
        reason: "The reply points at a comment this session did not send",
      });
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
  return jsonResponse({
    status: 200,
    value: {
      requestId: agentRequest.requestId,
      kind: agentRequest.kind,
      request: agentRequest,
    },
  });
};

/** Withdraws a request the agent has not answered yet. */
export const cancelPendingAgentRequest = async (
  context: ReviewRouteContext,
  { body }: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { store, planId, sessionId } = context;
  const payload = payloadOf(body);
  const requestId = payload.requestId;
  if (typeof requestId !== "string") {
    return refusal({ status: 400, reason: "A request id is required" });
  }
  const exchange = await readAgentExchange({ store, sessionId, planId });
  const agentRequest = exchange.requests.find(
    (candidate) => candidate.requestId === requestId,
  );
  if (agentRequest === undefined) {
    return refusal({ status: 404, reason: "No such agent request" });
  }
  if (
    exchange.responses.some(
      (candidate) => candidate.requestId === agentRequest.requestId,
    )
  ) {
    return refusal({
      status: 409,
      reason: "The agent has already answered this request",
    });
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
    return refusal({ status: 409, reason: error.message });
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
  return jsonResponse({ status: 200, value: { request: canceled } });
};
