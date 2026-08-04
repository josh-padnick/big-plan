// Owns the local coding-agent exchange contract. Reviewers and agents share
// only validated request and response values in the plan's ignored
// `.big-plan/` store; browser code and CLI commands never need to understand
// filenames, replay rules, response completeness, or source-revision checks.

import { createHash } from "node:crypto";
import type { CommentTarget, ReviewComment } from "./comment.js";
import type { FeedbackPackage } from "./feedback-package.js";
import type { RevisionPair } from "./revision-change-set.js";
import {
  parseMessageMarkdown,
  validateMessageNodes,
} from "./message-markdown.js";
import type { MessageNode } from "./message-markdown.js";
import {
  readAgentCancellations,
  readAgentRequestValues,
  readAgentResponseValues,
  writeAgentRequestValue,
  writeAgentResponseValue,
} from "./store.js";
import type { ReviewStore } from "./store.js";

const TEXT_LIMIT = 4000;
const MESSAGE_LIMIT = 200;
const EXCHANGE_LIMIT = 400;
const ID = /^[a-f0-9]{16}$/;
const BLOCK_ID = /^[a-z0-9][a-z0-9/_.-]{0,299}$/;

export type AgentOutcomeState = "changed" | "question" | "outside";

type AgentRequestBase = {
  readonly version: 1;
  readonly requestId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly sourceRevision: string;
  readonly createdAt: string;
};

export type AgentFeedbackRequest = AgentRequestBase & {
  readonly kind: "feedback";
  readonly packageId: string;
  readonly batchIndex: number;
  readonly batchSize: number;
  readonly comments: ReadonlyArray<ReviewComment>;
};

export type AgentReplyRequest = AgentRequestBase & {
  readonly kind: "reply";
  readonly commentId: string;
  readonly body: string;
};

export type AgentChatRequest = AgentRequestBase & {
  readonly kind: "chat";
  readonly body: string;
};

export type AgentRequest =
  AgentFeedbackRequest | AgentReplyRequest | AgentChatRequest;

export type AgentOutcome = {
  readonly commentId: string;
  readonly state: AgentOutcomeState;
  readonly message: string;
  readonly messageNodes?: ReadonlyArray<MessageNode>;
  readonly changes?: ReadonlyArray<{
    readonly placeId: string;
    readonly summary: string;
  }>;
};

type AgentResponseBase = {
  readonly version: 1;
  readonly requestId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly sourceRevision: string;
  readonly revisionPair: RevisionPair;
  readonly createdAt: string;
};

export type AgentThreadResponse = AgentResponseBase & {
  readonly kind: "feedback" | "reply";
  readonly outcomes: ReadonlyArray<AgentOutcome>;
};

export type AgentChatResponse = AgentResponseBase & {
  readonly kind: "chat";
  readonly message: string;
  readonly messageNodes?: ReadonlyArray<MessageNode>;
};

export type AgentResponse = AgentThreadResponse | AgentChatResponse;

export type AgentExchangeSnapshot = {
  readonly requests: ReadonlyArray<AgentRequest>;
  readonly responses: ReadonlyArray<AgentResponse>;
  readonly cancelledIds: ReadonlyArray<string>;
};

export class AgentExchangeRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentExchangeRejected";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = ({
  value,
  field,
  limit = TEXT_LIMIT,
}: {
  readonly value: unknown;
  readonly field: string;
  readonly limit?: number;
}): string => {
  if (typeof value !== "string") {
    throw new AgentExchangeRejected(`"${field}" must be text`);
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new AgentExchangeRejected(`"${field}" cannot be empty`);
  }
  if (trimmed.length > limit) {
    throw new AgentExchangeRejected(
      `"${field}" is longer than ${limit} characters`,
    );
  }
  return trimmed;
};

const id = (value: unknown, field: string): string => {
  const candidate = text({ value, field, limit: 16 });
  if (!ID.test(candidate)) {
    throw new AgentExchangeRejected(
      `"${field}" must be 16 hexadecimal characters`,
    );
  }
  return candidate;
};

const exchangeCommentId = (value: unknown, field: string): string => {
  const candidate = text({ value, field, limit: 64 });
  if (!/^[a-f0-9]{4,64}$/.test(candidate)) {
    throw new AgentExchangeRejected(
      `"${field}" must be a short hexadecimal identifier`,
    );
  }
  return candidate;
};

const timestamp = (value: unknown): string => {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new AgentExchangeRejected('"createdAt" must be an ISO timestamp');
  }
  return new Date(value).toISOString();
};

const sourceRevision = (value: unknown): string => {
  const candidate = text({ value, field: "sourceRevision", limit: 64 });
  if (!/^[a-f0-9]{16,64}$/.test(candidate)) {
    throw new AgentExchangeRejected(
      '"sourceRevision" must be a hexadecimal source digest',
    );
  }
  return candidate;
};

const target = (value: unknown): CommentTarget => {
  if (!isRecord(value)) {
    throw new AgentExchangeRejected(
      "A stored comment target must be an object",
    );
  }
  if (value.type === "document") {
    return { type: "document" };
  }
  if (
    (value.type !== "block" &&
      value.type !== "slide" &&
      value.type !== "selection" &&
      value.type !== "lines") ||
    typeof value.blockId !== "string" ||
    !BLOCK_ID.test(value.blockId)
  ) {
    throw new AgentExchangeRejected("A stored comment target is invalid");
  }
  const identity = {
    blockId: value.blockId,
    kind: text({ value: value.kind, field: "target.kind", limit: 100 }),
    label: text({ value: value.label, field: "target.label", limit: 300 }),
    ...(typeof value.section === "string" && value.section !== ""
      ? {
          section: text({
            value: value.section,
            field: "target.section",
            limit: 300,
          }),
        }
      : {}),
  };
  if (value.type === "block") {
    return { type: value.type, ...identity };
  }
  if (value.type === "slide") {
    const expectedScope = value.blockId.split("/").slice(0, -1).join("/");
    if (
      typeof value.scope !== "string" ||
      value.scope !== expectedScope ||
      !BLOCK_ID.test(value.scope)
    ) {
      throw new AgentExchangeRejected("A stored slide scope is invalid");
    }
    return { type: value.type, ...identity, scope: value.scope };
  }
  if (
    typeof value.start !== "number" ||
    !Number.isInteger(value.start) ||
    value.start < 0 ||
    typeof value.end !== "number" ||
    !Number.isInteger(value.end) ||
    value.end < value.start ||
    typeof value.quote !== "string" ||
    value.quote.length > 400
  ) {
    throw new AgentExchangeRejected("A stored comment range is invalid");
  }
  if (
    value.type === "selection" &&
    value.endBlockId !== undefined &&
    (typeof value.endBlockId !== "string" || !BLOCK_ID.test(value.endBlockId))
  ) {
    throw new AgentExchangeRejected(
      "A stored multi-block selection target is invalid",
    );
  }
  return {
    type: value.type,
    ...identity,
    ...(value.type === "selection" &&
    typeof value.endBlockId === "string" &&
    BLOCK_ID.test(value.endBlockId)
      ? { endBlockId: value.endBlockId }
      : {}),
    start: value.start,
    end: value.end,
    quote: value.quote,
  };
};

const comment = (value: unknown): ReviewComment => {
  if (!isRecord(value)) {
    throw new AgentExchangeRejected("A stored comment must be an object");
  }
  return {
    id: exchangeCommentId(value.id, "comment.id"),
    body: text({ value: value.body, field: "comment.body" }),
    createdAt: timestamp(value.createdAt),
    target: target(value.target),
  };
};

const requestBase = (
  value: Readonly<Record<string, unknown>>,
): AgentRequestBase => {
  if (value.version !== 1) {
    throw new AgentExchangeRejected("Unsupported agent request version");
  }
  return {
    version: 1,
    requestId: id(value.requestId, "requestId"),
    sessionId: id(value.sessionId, "sessionId"),
    planId: id(value.planId, "planId"),
    sourceRevision: sourceRevision(value.sourceRevision),
    createdAt: timestamp(value.createdAt),
  };
};

/** Re-checks one request read from the reviewer-owned filesystem. */
export const validateAgentRequest = (value: unknown): AgentRequest => {
  if (!isRecord(value)) {
    throw new AgentExchangeRejected("An agent request must be an object");
  }
  const base = requestBase(value);
  if (value.kind === "feedback") {
    if (
      !Array.isArray(value.comments) ||
      value.comments.length !== 1 ||
      typeof value.batchIndex !== "number" ||
      !Number.isInteger(value.batchIndex) ||
      value.batchIndex < 0 ||
      typeof value.batchSize !== "number" ||
      !Number.isInteger(value.batchSize) ||
      value.batchSize < 1 ||
      value.batchIndex >= value.batchSize
    ) {
      throw new AgentExchangeRejected(
        "A feedback request must own exactly one comment in its batch",
      );
    }
    return {
      ...base,
      kind: "feedback",
      packageId: id(value.packageId, "packageId"),
      batchIndex: value.batchIndex,
      batchSize: value.batchSize,
      comments: value.comments.map(comment),
    };
  }
  if (value.kind === "reply") {
    return {
      ...base,
      kind: "reply",
      commentId: exchangeCommentId(value.commentId, "commentId"),
      body: text({ value: value.body, field: "body" }),
    };
  }
  if (value.kind === "chat") {
    return {
      ...base,
      kind: "chat",
      body: text({ value: value.body, field: "body" }),
    };
  }
  throw new AgentExchangeRejected("Unsupported agent request kind");
};

const responseBase = ({
  request,
  fromRevision,
  currentRevision,
  now,
}: {
  readonly request: AgentRequest;
  readonly fromRevision: string;
  readonly currentRevision: string;
  readonly now: string;
}): AgentResponseBase => ({
  version: 1,
  requestId: request.requestId,
  sessionId: request.sessionId,
  planId: request.planId,
  sourceRevision: currentRevision,
  revisionPair: { fromRevision, toRevision: currentRevision },
  createdAt: now,
});

const expectedCommentIds = ({
  request,
  commentsById,
}: {
  readonly request: AgentFeedbackRequest | AgentReplyRequest;
  readonly commentsById: ReadonlyMap<string, ReviewComment>;
}): ReadonlyArray<string> => {
  if (request.kind === "feedback") {
    return request.comments.map((entry) => entry.id);
  }
  if (!commentsById.has(request.commentId)) {
    throw new AgentExchangeRejected(
      "The reply points at a comment this session does not contain",
    );
  }
  return [request.commentId];
};

const outcome = ({
  value,
  changedPlaceIds,
  fromRevision,
  currentRevision,
}: {
  readonly value: unknown;
  readonly changedPlaceIds: ReadonlySet<string>;
  readonly fromRevision: string;
  readonly currentRevision: string;
}): AgentOutcome => {
  if (!isRecord(value)) {
    throw new AgentExchangeRejected("Each outcome must be an object");
  }
  const checkedCommentId = exchangeCommentId(value.commentId, "commentId");
  const state = value.state;
  if (state !== "changed" && state !== "question" && state !== "outside") {
    throw new AgentExchangeRejected(
      'An outcome state must be "changed", "question", or "outside"',
    );
  }
  const result: AgentOutcome = {
    commentId: checkedCommentId,
    state,
    message: text({ value: value.message, field: "message" }),
  };
  const withMessage = {
    ...result,
    messageNodes: parseMessageMarkdown(result.message),
  };
  if (state !== "changed") {
    return withMessage;
  }
  if (currentRevision === fromRevision) {
    throw new AgentExchangeRejected(
      'A "changed" outcome requires a revision to the plan source',
    );
  }
  if (
    value.changes !== undefined &&
    (!Array.isArray(value.changes) || value.changes.length > MESSAGE_LIMIT)
  ) {
    throw new AgentExchangeRejected(
      '"changes" must be a list of optional place summaries',
    );
  }
  const changes = (Array.isArray(value.changes) ? value.changes : []).map(
    (entry) => {
      if (!isRecord(entry)) {
        throw new AgentExchangeRejected(
          'Every "changes" entry must contain a placeId and summary',
        );
      }
      const placeId = text({
        value: entry.placeId,
        field: "changes.placeId",
        limit: 16,
      });
      if (!ID.test(placeId) || !changedPlaceIds.has(placeId)) {
        throw new AgentExchangeRejected(
          'Every "changes.placeId" must name a real place in this revision pair',
        );
      }
      return {
        placeId,
        summary: text({
          value: entry.summary,
          field: "changes.summary",
          limit: 90,
        }),
      };
    },
  );
  if (new Set(changes.map(({ placeId }) => placeId)).size !== changes.length) {
    throw new AgentExchangeRejected(
      '"changes" cannot contain duplicate targets',
    );
  }
  return { ...withMessage, changes };
};

/** Validates an agent-authored draft and fills trusted session metadata. */
export const validateAgentResponseDraft = ({
  value,
  request,
  commentsById,
  changedPlaceIds,
  fromRevision,
  currentRevision,
  now,
}: {
  readonly value: unknown;
  readonly request: AgentRequest;
  readonly commentsById: ReadonlyMap<string, ReviewComment>;
  readonly changedPlaceIds: ReadonlySet<string>;
  readonly fromRevision: string;
  readonly currentRevision: string;
  readonly now: string;
}): AgentResponse => {
  if (!isRecord(value)) {
    throw new AgentExchangeRejected("An agent response must be an object");
  }
  if (value.requestId !== request.requestId) {
    throw new AgentExchangeRejected(
      "The response does not answer the pending request",
    );
  }
  const base = responseBase({ request, fromRevision, currentRevision, now });
  if (request.kind === "chat") {
    const message = text({ value: value.message, field: "message" });
    return {
      ...base,
      kind: "chat",
      message,
      messageNodes: parseMessageMarkdown(message),
    };
  }
  if (!Array.isArray(value.outcomes)) {
    throw new AgentExchangeRejected('"outcomes" must be a list');
  }
  const expected = expectedCommentIds({ request, commentsById });
  const outcomes = value.outcomes.map((entry) =>
    outcome({
      value: entry,
      changedPlaceIds,
      fromRevision,
      currentRevision,
    }),
  );
  const actual = outcomes.map((entry) => entry.commentId);
  if (
    new Set(actual).size !== actual.length ||
    expected.length !== actual.length ||
    expected.some((commentId) => !actual.includes(commentId))
  ) {
    throw new AgentExchangeRejected(
      "The response must contain exactly one outcome for every requested comment",
    );
  }
  return { ...base, kind: request.kind, outcomes };
};

const validateStoredResponse = ({
  value,
  request,
  commentsById,
}: {
  readonly value: unknown;
  readonly request: AgentRequest;
  readonly commentsById: ReadonlyMap<string, ReviewComment>;
}): AgentResponse => {
  if (!isRecord(value) || value.version !== 1) {
    throw new AgentExchangeRejected("A stored agent response is invalid");
  }
  if (
    value.requestId !== request.requestId ||
    value.sessionId !== request.sessionId ||
    value.planId !== request.planId ||
    value.kind !== request.kind
  ) {
    throw new AgentExchangeRejected(
      "A stored agent response does not match its request",
    );
  }
  const base: AgentResponseBase = {
    version: 1,
    requestId: request.requestId,
    sessionId: request.sessionId,
    planId: request.planId,
    sourceRevision: sourceRevision(value.sourceRevision),
    revisionPair: (() => {
      if (!isRecord(value.revisionPair)) {
        throw new AgentExchangeRejected("A stored revision pair is invalid");
      }
      return {
        fromRevision: sourceRevision(value.revisionPair.fromRevision),
        toRevision: sourceRevision(value.revisionPair.toRevision),
      };
    })(),
    createdAt: timestamp(value.createdAt),
  };
  if (base.revisionPair.toRevision !== base.sourceRevision) {
    throw new AgentExchangeRejected(
      "A stored revision pair must end at the response revision",
    );
  }
  if (request.kind === "chat") {
    const message = text({ value: value.message, field: "message" });
    return {
      ...base,
      kind: "chat",
      message,
      ...(value.messageNodes === undefined
        ? {}
        : { messageNodes: validateMessageNodes(value.messageNodes) }),
    };
  }
  if (!Array.isArray(value.outcomes)) {
    throw new AgentExchangeRejected("A stored outcome list is invalid");
  }
  const expected = expectedCommentIds({ request, commentsById });
  const outcomes: ReadonlyArray<AgentOutcome> = value.outcomes.map((entry) => {
    if (!isRecord(entry)) {
      throw new AgentExchangeRejected("A stored outcome is invalid");
    }
    const checkedCommentId = exchangeCommentId(entry.commentId, "commentId");
    if (
      entry.state !== "changed" &&
      entry.state !== "question" &&
      entry.state !== "outside"
    ) {
      throw new AgentExchangeRejected("A stored outcome state is invalid");
    }
    const result: AgentOutcome = {
      commentId: checkedCommentId,
      state: entry.state,
      message: text({ value: entry.message, field: "message" }),
      ...(entry.messageNodes === undefined
        ? {}
        : { messageNodes: validateMessageNodes(entry.messageNodes) }),
    };
    if (entry.state !== "changed") {
      return result;
    }
    if (
      (entry.changes !== undefined && !Array.isArray(entry.changes)) ||
      (Array.isArray(entry.changes) &&
        entry.changes.some(
          (change) =>
            !isRecord(change) ||
            typeof change.placeId !== "string" ||
            !ID.test(change.placeId) ||
            typeof change.summary !== "string" ||
            change.summary.trim() === "" ||
            change.summary.trim().length > 90,
        ))
    ) {
      throw new AgentExchangeRejected("Stored changes are invalid");
    }
    const changes = (Array.isArray(entry.changes) ? entry.changes : []).map(
      (change) => {
        if (!isRecord(change)) {
          throw new AgentExchangeRejected("Stored changes are invalid");
        }
        return {
          placeId: text({
            value: change.placeId,
            field: "changes.placeId",
            limit: 16,
          }),
          summary: text({
            value: change.summary,
            field: "changes.summary",
            limit: 90,
          }),
        };
      },
    );
    return { ...result, changes };
  });
  const actual = outcomes.map((entry) => entry.commentId);
  if (
    new Set(actual).size !== actual.length ||
    expected.length !== actual.length ||
    expected.some((commentId) => !actual.includes(commentId))
  ) {
    throw new AgentExchangeRejected("A stored outcome set is incomplete");
  }
  return { ...base, kind: request.kind, outcomes };
};

/** A source digest shared by request creation, response validation, and polling. */
export const deriveSourceRevision = (source: string): string =>
  createHash("sha256").update(source).digest("hex").slice(0, 16);

/** Fans Send all into ordered, causally isolated one-comment exchanges. */
export const feedbackAgentRequests = ({
  feedback,
  sourceRevision: revision,
  requestIds,
}: {
  readonly feedback: FeedbackPackage;
  readonly sourceRevision: string;
  readonly requestIds: ReadonlyArray<string>;
}): ReadonlyArray<AgentFeedbackRequest> => {
  if (requestIds.length !== feedback.comments.length) {
    throw new AgentExchangeRejected(
      "Every feedback comment needs one exchange identifier",
    );
  }
  const startedAt = Date.parse(feedback.createdAt);
  return feedback.comments.map((entry, batchIndex) => ({
    version: 1,
    requestId: id(requestIds[batchIndex], "requestId"),
    sessionId: feedback.sessionId,
    planId: feedback.planId,
    sourceRevision: revision,
    createdAt: new Date(startedAt + batchIndex).toISOString(),
    kind: "feedback",
    packageId: feedback.packageId,
    batchIndex,
    batchSize: feedback.comments.length,
    comments: [entry],
  }));
};

/** Creates a reviewer reply or plan-chat request for the same live session. */
export const messageAgentRequest = ({
  kind,
  requestId,
  sessionId,
  planId,
  sourceRevision: revision,
  createdAt,
  body,
  commentId,
}: {
  readonly kind: "reply" | "chat";
  readonly requestId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly sourceRevision: string;
  readonly createdAt: string;
  readonly body: string;
  readonly commentId?: string;
}): AgentReplyRequest | AgentChatRequest => {
  const base: AgentRequestBase = {
    version: 1,
    requestId: id(requestId, "requestId"),
    sessionId: id(sessionId, "sessionId"),
    planId: id(planId, "planId"),
    sourceRevision: sourceRevision(revision),
    createdAt: timestamp(createdAt),
  };
  const checkedBody = text({ value: body, field: "body" });
  if (kind === "chat") {
    return { ...base, kind, body: checkedBody };
  }
  return {
    ...base,
    kind,
    commentId: exchangeCommentId(commentId, "commentId"),
    body: checkedBody,
  };
};

/** Writes a runtime-authored request after re-checking its complete shape. */
export const writeAgentRequest = async ({
  store,
  request,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
}): Promise<void> => {
  const checked = validateAgentRequest(request);
  await writeAgentRequestValue({
    store,
    requestId: checked.requestId,
    value: checked,
  });
};

/** Writes a response only after the exchange module has validated it. */
export const writeAgentResponse = async ({
  store,
  response,
}: {
  readonly store: ReviewStore;
  readonly response: AgentResponse;
}): Promise<void> => {
  await writeAgentResponseValue({
    store,
    requestId: response.requestId,
    value: response,
  });
};

/**
 * Reads the whole plan exchange through the contract. A review-server restart
 * creates a new transport session, but the plan identity continues to own its
 * threads and outcomes. Invalid, foreign-plan, duplicate, and orphaned files
 * disappear instead of reaching either the agent or viewer.
 */
export const readAgentExchange = async ({
  store,
  sessionId,
  planId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
}): Promise<AgentExchangeSnapshot> => {
  const requests: Array<AgentRequest> = [];
  for (const value of (await readAgentRequestValues(store)).slice(
    0,
    EXCHANGE_LIMIT,
  )) {
    try {
      const request = validateAgentRequest(value);
      if (
        request.planId === planId &&
        !requests.some((entry) => entry.requestId === request.requestId)
      ) {
        requests.push(request);
      }
    } catch {
      // A hand-edited exchange file is ignored, never trusted or fatal.
    }
  }
  requests.sort((left, right) => {
    const chronological = left.createdAt.localeCompare(right.createdAt);
    if (chronological !== 0) return chronological;
    return (
      Number(right.sessionId === sessionId) -
      Number(left.sessionId === sessionId)
    );
  });
  const commentsById = new Map<string, ReviewComment>();
  for (const request of requests) {
    if (request.kind === "feedback") {
      for (const entry of request.comments) {
        commentsById.set(entry.id, entry);
      }
    }
  }
  const requestById = new Map(
    requests.map((request) => [request.requestId, request]),
  );
  const responses: Array<AgentResponse> = [];
  for (const value of (await readAgentResponseValues(store)).slice(
    0,
    EXCHANGE_LIMIT,
  )) {
    try {
      if (!isRecord(value) || typeof value.requestId !== "string") {
        continue;
      }
      const request = requestById.get(value.requestId);
      if (request === undefined) {
        continue;
      }
      const response = validateStoredResponse({
        value,
        request,
        commentsById,
      });
      if (!responses.some((entry) => entry.requestId === response.requestId)) {
        responses.push(response);
      }
    } catch {
      // The response command normally owns these files; disk remains untrusted.
    }
  }
  responses.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
  const cancelledIds = (await readAgentCancellations({ store }))
    .map(({ requestId }) => requestId)
    .filter((requestId) => requestById.has(requestId));
  return { requests, responses, cancelledIds };
};

/** Returns the oldest request that does not yet have a validated response. */
export const nextPendingAgentRequest = (
  snapshot: AgentExchangeSnapshot,
): AgentRequest | undefined => {
  const answered = new Set(
    snapshot.responses.map((response) => response.requestId),
  );
  const cancelled = new Set(snapshot.cancelledIds);
  return snapshot.requests.find(
    (request) =>
      !answered.has(request.requestId) && !cancelled.has(request.requestId),
  );
};

/**
 * Resolves the causal baseline for one serialized work item. Later comments in
 * a Send-all batch begin where the preceding comment's immutable pair ended.
 */
export const effectiveSourceRevision = ({
  request,
  snapshot,
}: {
  readonly request: AgentRequest;
  readonly snapshot: AgentExchangeSnapshot;
}): string => {
  if (request.kind !== "feedback" || request.batchIndex === 0) {
    return request.sourceRevision;
  }
  const previous = snapshot.requests.find(
    (candidate) =>
      candidate.kind === "feedback" &&
      candidate.packageId === request.packageId &&
      candidate.batchIndex === request.batchIndex - 1,
  );
  const response =
    previous === undefined
      ? undefined
      : snapshot.responses.find(
          (candidate) => candidate.requestId === previous.requestId,
        );
  return response?.revisionPair.toRevision ?? request.sourceRevision;
};

/** Collects the original comments needed to validate a reply response. */
export const commentsFromExchange = (
  snapshot: AgentExchangeSnapshot,
): ReadonlyMap<string, ReviewComment> => {
  const comments = new Map<string, ReviewComment>();
  for (const request of snapshot.requests) {
    if (request.kind === "feedback") {
      for (const entry of request.comments) {
        comments.set(entry.id, entry);
      }
    }
  }
  return comments;
};

/** Gives a coding agent the smallest valid draft shape for one work item. */
export const responseTemplateFor = (
  request: AgentRequest,
): Readonly<Record<string, unknown>> => {
  if (request.kind === "chat") {
    return {
      requestId: request.requestId,
      message: "Answer the reviewer's plan-wide question.",
    };
  }
  const commentIds =
    request.kind === "feedback"
      ? request.comments.map((entry) => entry.id)
      : [request.commentId];
  return {
    requestId: request.requestId,
    outcomes: commentIds.map((commentId) => ({
      commentId,
      state: "changed",
      message: "Explain the concrete revision or why another outcome applies.",
      changes: [],
    })),
  };
};
