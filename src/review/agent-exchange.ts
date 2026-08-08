// Owns the local coding-agent exchange contract. Reviewers and agents share
// only validated request and response values in the plan's ignored
// `.big-plan/` store; browser code and CLI commands never need to understand
// filenames, replay rules, response completeness, or source-revision checks.

import { createHash } from "node:crypto";
import type { CommentTarget, ReviewComment } from "./comment.js";
import type { FeedbackPackage } from "./feedback-package.js";
import {
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
  readonly claimedFromRevision?: string;
  readonly claimedAt?: string;
};

export type AgentFeedbackRequest = AgentRequestBase & {
  readonly kind: "feedback";
  readonly packageId: string;
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
  readonly changeTargets?: ReadonlyArray<string>;
};

type AgentResponseBase = {
  readonly version: 1;
  readonly requestId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly sourceRevision: string;
  readonly createdAt: string;
};

export type AgentThreadResponse = AgentResponseBase & {
  readonly kind: "feedback" | "reply";
  readonly outcomes: ReadonlyArray<AgentOutcome>;
};

export type AgentChatResponse = AgentResponseBase & {
  readonly kind: "chat";
  readonly message: string;
};

export type AgentResponse = AgentThreadResponse | AgentChatResponse;

export type AgentExchangeSnapshot = {
  readonly requests: ReadonlyArray<AgentRequest>;
  readonly responses: ReadonlyArray<AgentResponse>;
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
    return { type: "block", ...identity };
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
  return {
    type: value.type,
    ...identity,
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
  const claimedFromRevision =
    value.claimedFromRevision === undefined
      ? undefined
      : sourceRevision(value.claimedFromRevision);
  const claimedAt =
    value.claimedAt === undefined ? undefined : timestamp(value.claimedAt);
  if ((claimedFromRevision === undefined) !== (claimedAt === undefined)) {
    throw new AgentExchangeRejected(
      '"claimedFromRevision" and "claimedAt" must appear together',
    );
  }
  return {
    version: 1,
    requestId: id(value.requestId, "requestId"),
    sessionId: id(value.sessionId, "sessionId"),
    planId: id(value.planId, "planId"),
    sourceRevision: sourceRevision(value.sourceRevision),
    createdAt: timestamp(value.createdAt),
    ...(claimedFromRevision === undefined
      ? {}
      : { claimedFromRevision, claimedAt }),
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
      value.comments.length === 0 ||
      value.comments.length > MESSAGE_LIMIT
    ) {
      throw new AgentExchangeRejected(
        "A feedback request must contain comments",
      );
    }
    return {
      ...base,
      kind: "feedback",
      packageId: id(value.packageId, "packageId"),
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
  currentRevision,
  now,
}: {
  readonly request: AgentRequest;
  readonly currentRevision: string;
  readonly now: string;
}): AgentResponseBase => ({
  version: 1,
  requestId: request.requestId,
  sessionId: request.sessionId,
  planId: request.planId,
  sourceRevision: currentRevision,
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
  request,
  changedBlocks,
  currentRevision,
}: {
  readonly value: unknown;
  readonly request: AgentFeedbackRequest | AgentReplyRequest;
  readonly changedBlocks: ReadonlySet<string>;
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
  if (state !== "changed") {
    return result;
  }
  if (
    currentRevision === (request.claimedFromRevision ?? request.sourceRevision)
  ) {
    throw new AgentExchangeRejected(
      'A "changed" outcome requires a revision to the plan source',
    );
  }
  if (
    !Array.isArray(value.changeTargets) ||
    value.changeTargets.length === 0 ||
    value.changeTargets.length > MESSAGE_LIMIT
  ) {
    throw new AgentExchangeRejected(
      'A "changed" outcome must list at least one changed block',
    );
  }
  const changeTargets = value.changeTargets.map((entry) => {
    const changeTarget = text({
      value: entry,
      field: "changeTargets",
      limit: 300,
    });
    if (!BLOCK_ID.test(changeTarget) || !changedBlocks.has(changeTarget)) {
      throw new AgentExchangeRejected(
        'Every "changeTargets" entry must name a block changed by this revision',
      );
    }
    return changeTarget;
  });
  if (new Set(changeTargets).size !== changeTargets.length) {
    throw new AgentExchangeRejected(
      '"changeTargets" cannot contain duplicates',
    );
  }
  return { ...result, changeTargets };
};

/** Freezes the source baseline when an agent first claims a pending request. */
export const claimAgentRequest = async ({
  store,
  request,
  sourceRevision: claimedFromRevision,
  now,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
  readonly sourceRevision: string;
  readonly now: string;
}): Promise<AgentRequest> => {
  if (request.claimedFromRevision !== undefined) return request;
  const claimed = validateAgentRequest({
    ...request,
    claimedFromRevision,
    claimedAt: now,
  });
  await writeAgentRequestValue({
    store,
    requestId: request.requestId,
    value: claimed,
  });
  return claimed;
};

/** The immutable revision an agent actually saw when it claimed the work. */
export const requestBaselineRevision = (request: AgentRequest): string =>
  request.claimedFromRevision ?? request.sourceRevision;

/** Validates an agent-authored draft and fills trusted session metadata. */
export const validateAgentResponseDraft = ({
  value,
  request,
  commentsById,
  changedBlocks,
  currentRevision,
  now,
}: {
  readonly value: unknown;
  readonly request: AgentRequest;
  readonly commentsById: ReadonlyMap<string, ReviewComment>;
  readonly changedBlocks: ReadonlySet<string>;
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
  const base = responseBase({ request, currentRevision, now });
  if (request.kind === "chat") {
    return {
      ...base,
      kind: "chat",
      message: text({ value: value.message, field: "message" }),
    };
  }
  if (!Array.isArray(value.outcomes)) {
    throw new AgentExchangeRejected('"outcomes" must be a list');
  }
  const expected = expectedCommentIds({ request, commentsById });
  const outcomes = value.outcomes.map((entry) =>
    outcome({
      value: entry,
      request,
      changedBlocks,
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
    createdAt: timestamp(value.createdAt),
  };
  if (request.kind === "chat") {
    return {
      ...base,
      kind: "chat",
      message: text({ value: value.message, field: "message" }),
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
    };
    if (entry.state !== "changed") {
      return result;
    }
    if (
      !Array.isArray(entry.changeTargets) ||
      entry.changeTargets.length === 0 ||
      entry.changeTargets.some(
        (target) => typeof target !== "string" || !BLOCK_ID.test(target),
      )
    ) {
      throw new AgentExchangeRejected("Stored change targets are invalid");
    }
    return { ...result, changeTargets: entry.changeTargets };
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

/** Turns one real feedback package into the first coding-agent request. */
export const feedbackAgentRequest = ({
  feedback,
  sourceRevision: revision,
}: {
  readonly feedback: FeedbackPackage;
  readonly sourceRevision: string;
}): AgentFeedbackRequest => ({
  version: 1,
  requestId: feedback.packageId,
  sessionId: feedback.sessionId,
  planId: feedback.planId,
  sourceRevision: revision,
  createdAt: feedback.createdAt,
  kind: "feedback",
  packageId: feedback.packageId,
  comments: feedback.comments,
});

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
  return { requests, responses };
};

/** Returns the oldest request that does not yet have a validated response. */
export const nextPendingAgentRequest = (
  snapshot: AgentExchangeSnapshot,
): AgentRequest | undefined => {
  const answered = new Set(
    snapshot.responses.map((response) => response.requestId),
  );
  return snapshot.requests.find((request) => !answered.has(request.requestId));
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
      changeTargets: ["replace-with-each-changed-block-id"],
    })),
  };
};
