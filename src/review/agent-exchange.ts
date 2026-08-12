// Owns the local coding-agent exchange contract. Reviewers and agents share
// only validated request and response values in the plan's ignored
// `.big-plan/` store; browser code and CLI commands never need to understand
// filenames, replay rules, response completeness, or source-snapshot checks.

import { createHash } from "node:crypto";
import type { CommentTarget, ReviewComment } from "./shared/comment.js";
import type { FeedbackPackage } from "./feedback-package.js";
import {
  readAgentRequestValues,
  readAgentResponseValue,
  readAgentResponseValues,
  writeAgentRequestValue,
} from "./store.js";
import type { ReviewStore } from "./store.js";

const TEXT_LIMIT = 4000;
const MESSAGE_LIMIT = 200;
const EXCHANGE_LIMIT = 400;
const WARNING_SUMMARY_LIMIT = 80;
const ID = /^[a-f0-9]{16}$/;
const BLOCK_ID = /^[a-z0-9][a-z0-9/_.-]{0,299}$/;

export type AgentOutcomeState =
  "answered" | "changed" | "warning" | "needs-input" | "declined";

type AgentRequestBase = {
  readonly version: 1;
  readonly requestId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly premiseSnapshot: string;
  readonly createdAt: string;
  readonly baselineSnapshot?: string;
  readonly claimedAt?: string;
  readonly canceledAt?: string;
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
  /** One scannable line, present exactly when the state is "warning". */
  readonly summary?: string;
  readonly changeTargets?: ReadonlyArray<string>;
};

type AgentResponseBase = {
  readonly version: 1;
  readonly requestId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly resultSnapshot: string;
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

const snapshotDigest = (value: unknown, field: string): string => {
  const candidate = text({ value, field, limit: 64 });
  if (!/^[a-f0-9]{16,64}$/.test(candidate)) {
    throw new AgentExchangeRejected(
      `"${field}" must be a hexadecimal snapshot digest`,
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
  const endBlockId =
    value.type === "selection" && typeof value.endBlockId === "string"
      ? value.endBlockId
      : undefined;
  if (
    typeof value.start !== "number" ||
    !Number.isInteger(value.start) ||
    value.start < 0 ||
    typeof value.end !== "number" ||
    !Number.isInteger(value.end) ||
    (endBlockId === undefined && value.end < value.start) ||
    (endBlockId !== undefined && !BLOCK_ID.test(endBlockId)) ||
    typeof value.quote !== "string" ||
    value.quote.length > 400
  ) {
    throw new AgentExchangeRejected("A stored comment range is invalid");
  }
  return {
    type: value.type,
    ...identity,
    ...(endBlockId === undefined || endBlockId === value.blockId
      ? {}
      : { endBlockId }),
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
    premiseSnapshot: snapshotDigest(
      value.premiseSnapshot,
      "comment.premiseSnapshot",
    ),
    target: target(value.target),
  };
};

const requestBase = (
  value: Readonly<Record<string, unknown>>,
): AgentRequestBase => {
  if (value.version !== 1) {
    throw new AgentExchangeRejected("Unsupported agent request version");
  }
  const baselineSnapshot =
    value.baselineSnapshot === undefined
      ? undefined
      : snapshotDigest(value.baselineSnapshot, "baselineSnapshot");
  const claimedAt =
    value.claimedAt === undefined ? undefined : timestamp(value.claimedAt);
  const canceledAt =
    value.canceledAt === undefined ? undefined : timestamp(value.canceledAt);
  if ((baselineSnapshot === undefined) !== (claimedAt === undefined)) {
    throw new AgentExchangeRejected(
      '"baselineSnapshot" and "claimedAt" must appear together',
    );
  }
  return {
    version: 1,
    requestId: id(value.requestId, "requestId"),
    sessionId: id(value.sessionId, "sessionId"),
    planId: id(value.planId, "planId"),
    premiseSnapshot: snapshotDigest(value.premiseSnapshot, "premiseSnapshot"),
    createdAt: timestamp(value.createdAt),
    ...(baselineSnapshot === undefined ? {} : { baselineSnapshot, claimedAt }),
    ...(canceledAt === undefined ? {} : { canceledAt }),
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
  currentSnapshot,
  now,
}: {
  readonly request: AgentRequest;
  readonly currentSnapshot: string;
  readonly now: string;
}): AgentResponseBase => ({
  version: 1,
  requestId: request.requestId,
  sessionId: request.sessionId,
  planId: request.planId,
  resultSnapshot: currentSnapshot,
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

/**
 * A warning pauses the reviewer behind an explicit confirmation, so its badge
 * needs one scannable line naming the boundary; browser code must never slice
 * the summary out of the longer message.
 */
const warningSummary = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AgentExchangeRejected(
      'A "warning" outcome must carry a "summary": one short line naming the boundary the request would cross, such as "Would mix languages in one list"',
    );
  }
  const trimmed = value.trim();
  if (trimmed.length > WARNING_SUMMARY_LIMIT) {
    throw new AgentExchangeRejected(
      `"summary" is longer than ${WARNING_SUMMARY_LIMIT} characters; keep it to one scannable line`,
    );
  }
  return trimmed;
};

const outcome = ({
  value,
  request,
  changedBlocks,
  currentSnapshot,
}: {
  readonly value: unknown;
  readonly request: AgentFeedbackRequest | AgentReplyRequest;
  readonly changedBlocks: ReadonlySet<string>;
  readonly currentSnapshot: string;
}): AgentOutcome => {
  if (!isRecord(value)) {
    throw new AgentExchangeRejected("Each outcome must be an object");
  }
  const checkedCommentId = exchangeCommentId(value.commentId, "commentId");
  const state = value.state;
  if (
    state !== "answered" &&
    state !== "changed" &&
    state !== "warning" &&
    state !== "needs-input" &&
    state !== "declined"
  ) {
    throw new AgentExchangeRejected(
      'An outcome state must be "answered", "changed", "warning", "needs-input", or "declined"',
    );
  }
  const result: AgentOutcome = {
    commentId: checkedCommentId,
    state,
    message: text({ value: value.message, field: "message" }),
    ...(state === "warning" ? { summary: warningSummary(value.summary) } : {}),
  };
  if (state !== "changed") {
    return result;
  }
  if (
    currentSnapshot === (request.baselineSnapshot ?? request.premiseSnapshot)
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

/** The immutable revision an agent actually saw when it claimed the work. */
export const requestBaselineSnapshot = (request: AgentRequest): string =>
  request.baselineSnapshot ?? request.premiseSnapshot;

/** Validates an agent-authored draft and fills trusted session metadata. */
export const validateAgentResponseDraft = ({
  value,
  request,
  commentsById,
  changedBlocks,
  currentSnapshot,
  now,
}: {
  readonly value: unknown;
  readonly request: AgentRequest;
  readonly commentsById: ReadonlyMap<string, ReviewComment>;
  readonly changedBlocks: ReadonlySet<string>;
  readonly currentSnapshot: string;
  readonly now: string;
}): AgentResponse => {
  if (request.canceledAt !== undefined) {
    throw new AgentExchangeRejected("The request was canceled by the reviewer");
  }
  if (!isRecord(value)) {
    throw new AgentExchangeRejected("An agent response must be an object");
  }
  if (value.requestId !== request.requestId) {
    throw new AgentExchangeRejected(
      "The response does not answer the pending request",
    );
  }
  const base = responseBase({ request, currentSnapshot, now });
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
      currentSnapshot,
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
  if (
    request.claimedAt === undefined ||
    request.baselineSnapshot === undefined
  ) {
    throw new AgentExchangeRejected(
      "A stored agent response cannot answer an unclaimed request",
    );
  }
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
    resultSnapshot: snapshotDigest(value.resultSnapshot, "resultSnapshot"),
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
      entry.state !== "answered" &&
      entry.state !== "changed" &&
      entry.state !== "warning" &&
      entry.state !== "needs-input" &&
      entry.state !== "declined"
    ) {
      throw new AgentExchangeRejected("A stored outcome state is invalid");
    }
    const result: AgentOutcome = {
      commentId: checkedCommentId,
      state: entry.state,
      message: text({ value: entry.message, field: "message" }),
      ...(entry.state === "warning"
        ? { summary: warningSummary(entry.summary) }
        : {}),
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

const commentsFromRequests = (
  requests: ReadonlyArray<AgentRequest>,
): ReadonlyMap<string, ReviewComment> => {
  const comments = new Map<string, ReviewComment>();
  for (const request of requests) {
    if (request.kind === "feedback") {
      for (const entry of request.comments) {
        comments.set(entry.id, entry);
      }
    }
  }
  return comments;
};

const readAcceptedAgentRequests = async ({
  store,
  sessionId,
  planId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
}): Promise<ReadonlyArray<AgentRequest>> => {
  const acceptedRequests: Array<AgentRequest> = [];
  const acceptedRequestIds = new Set<string>();
  for (const value of await readAgentRequestValues(store)) {
    try {
      const request = validateAgentRequest(value);
      if (
        request.planId === planId &&
        !acceptedRequestIds.has(request.requestId)
      ) {
        acceptedRequests.push(request);
        acceptedRequestIds.add(request.requestId);
      }
    } catch {
      // A hand-edited exchange file is ignored, never trusted or fatal.
    }
  }
  acceptedRequests.sort((left, right) => {
    const chronological = left.createdAt.localeCompare(right.createdAt);
    if (chronological !== 0) return chronological;
    const currentSession =
      Number(left.sessionId === sessionId) -
      Number(right.sessionId === sessionId);
    if (currentSession !== 0) return currentSession;
    return left.requestId.localeCompare(right.requestId);
  });
  return acceptedRequests;
};

const readCompleteAgentExchange = async ({
  store,
  sessionId,
  planId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
}): Promise<AgentExchangeSnapshot> => {
  const requests = await readAcceptedAgentRequests({
    store,
    sessionId,
    planId,
  });
  const commentsById = commentsFromRequests(requests);
  const requestById = new Map(
    requests.map((request) => [request.requestId, request]),
  );
  const responses: Array<AgentResponse> = [];
  const responseRequestIds = new Set<string>();
  for (const value of await readAgentResponseValues(store)) {
    try {
      if (!isRecord(value) || typeof value.requestId !== "string") continue;
      const request = requestById.get(value.requestId);
      if (request === undefined) continue;
      const response = validateStoredResponse({ value, request, commentsById });
      if (!responseRequestIds.has(response.requestId)) {
        responses.push(response);
        responseRequestIds.add(response.requestId);
      }
    } catch {
      // The response command normally owns these files; disk remains untrusted.
    }
  }
  responses.sort((left, right) => {
    const chronological = left.createdAt.localeCompare(right.createdAt);
    if (chronological !== 0) return chronological;
    return left.requestId.localeCompare(right.requestId);
  });
  return { requests, responses };
};

/** A source digest shared by request creation, response validation, and polling. */
export const deriveSnapshotDigest = (source: string): string =>
  createHash("sha256").update(source).digest("hex").slice(0, 16);

/** Turns one real feedback package into the first coding-agent request. */
export const feedbackAgentRequest = ({
  feedback,
  premiseSnapshot,
}: {
  readonly feedback: FeedbackPackage;
  readonly premiseSnapshot: string;
}): AgentFeedbackRequest => ({
  version: 1,
  requestId: feedback.packageId,
  sessionId: feedback.sessionId,
  planId: feedback.planId,
  premiseSnapshot: snapshotDigest(premiseSnapshot, "premiseSnapshot"),
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
  premiseSnapshot,
  createdAt,
  body,
  commentId,
}: {
  readonly kind: "reply" | "chat";
  readonly requestId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly premiseSnapshot: string;
  readonly createdAt: string;
  readonly body: string;
  readonly commentId?: string;
}): AgentReplyRequest | AgentChatRequest => {
  const base: AgentRequestBase = {
    version: 1,
    requestId: id(requestId, "requestId"),
    sessionId: id(sessionId, "sessionId"),
    planId: id(planId, "planId"),
    premiseSnapshot: snapshotDigest(premiseSnapshot, "premiseSnapshot"),
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
  const complete = await readCompleteAgentExchange({
    store,
    sessionId,
    planId,
  });
  const answeredRequestIds = new Set(
    complete.responses.map((response) => response.requestId),
  );
  const pending = complete.requests.filter(
    (request) =>
      request.canceledAt === undefined &&
      !answeredRequestIds.has(request.requestId),
  );
  const terminal = complete.requests
    .filter(
      (request) =>
        request.canceledAt !== undefined ||
        answeredRequestIds.has(request.requestId),
    )
    .slice(-EXCHANGE_LIMIT);
  const retainedRequestIds = new Set(
    [...pending, ...terminal].map((request) => request.requestId),
  );
  const requests = complete.requests.filter((request) =>
    retainedRequestIds.has(request.requestId),
  );
  const responses = complete.responses.filter((response) =>
    retainedRequestIds.has(response.requestId),
  );
  return { requests, responses: responses.slice(-EXCHANGE_LIMIT) };
};

/** Reads complete validated history for one comment's authorization decisions. */
export const readAgentCommentHistory = async ({
  store,
  sessionId,
  planId,
  commentId,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly commentId: string;
}): Promise<AgentExchangeSnapshot> => {
  const complete = await readCompleteAgentExchange({
    store,
    sessionId,
    planId,
  });
  const requests = complete.requests.filter(
    (request) =>
      (request.kind === "feedback" &&
        request.comments.some((comment) => comment.id === commentId)) ||
      (request.kind === "reply" && request.commentId === commentId),
  );
  const requestIds = new Set(requests.map((request) => request.requestId));
  return {
    requests,
    responses: complete.responses.filter((response) =>
      requestIds.has(response.requestId),
    ),
  };
};

/** Reads one response only when its complete persisted shape is valid. */
export const readValidatedAgentResponse = async ({
  store,
  request,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
}): Promise<AgentResponse | undefined> => {
  const requests = await readAcceptedAgentRequests({
    store,
    sessionId: request.sessionId,
    planId: request.planId,
  });
  try {
    return validateStoredResponse({
      value: await readAgentResponseValue({
        store,
        requestId: request.requestId,
      }),
      request,
      commentsById: commentsFromRequests(requests),
    });
  } catch {
    return undefined;
  }
};

/** Returns the oldest request that does not yet have a validated response. */
export const nextPendingAgentRequest = (
  snapshot: AgentExchangeSnapshot,
): AgentRequest | undefined => {
  const answered = new Set(
    snapshot.responses.map((response) => response.requestId),
  );
  return snapshot.requests.find(
    (request) =>
      request.canceledAt === undefined && !answered.has(request.requestId),
  );
};

/** Collects the original comments needed to validate a reply response. */
export const commentsFromExchange = (
  snapshot: AgentExchangeSnapshot,
): ReadonlyMap<string, ReviewComment> =>
  commentsFromRequests(snapshot.requests);

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
