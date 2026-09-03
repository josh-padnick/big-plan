// Owns the local coding-agent exchange contract. Reviewers and agents share
// only validated request and response values in the plan's ignored
// `.big-plan/` store; browser code and CLI commands never need to understand
// filenames, replay rules, response completeness, or source-snapshot checks.

import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import type { CommentTarget, ReviewComment } from "./shared/comment.js";
import {
  QUOTE_LIMIT,
  SLIDE_SUB_HEADING_LIMIT,
  SLIDE_SUB_HEADING_TEXT_LIMIT,
  SLIDE_TEXT_LIMIT,
} from "./shared/comment.js";
import { claimIsHeldByAnother, claimIsLive } from "./shared/agent-claim.js";
import {
  requestIsTerminal,
  type TerminalAgentRequest,
} from "./shared/agent-request-state.js";
import type { FeedbackPackage } from "./feedback-package.js";
import {
  readAgentRequestValues,
  readAgentResponseValue,
  listAgentResponseRequestIds,
  readAgentResponseValuesFor,
  writeAgentRequestValue,
} from "./store.js";
import type { ReviewStore } from "./store.js";
import {
  isReviewImageId,
  isReviewImageWithinLimits,
  type ReviewImageAttachment,
} from "./shared/review-image.js";
import {
  decodeAgentModelIdentity,
  type AgentModelIdentity,
} from "./shared/agent-model.js";
import { agentOwnsRequest } from "./shared/request-ownership.js";
import { requestIsOutstanding } from "./shared/request-lifecycle.js";
import { compareTimestamps } from "./shared/timestamp-order.js";
import { APPROVAL_MESSAGE_LIMIT } from "./shared/approval-message.js";

const TEXT_LIMIT = 4000;
const MESSAGE_LIMIT = 200;
const EXCHANGE_LIMIT = 400;
const WARNING_SUMMARY_LIMIT = 80;
const APPROVAL_HARD_STOP_LIMIT = 500;
const ID = /^[a-f0-9]{16}$/;
const BLOCK_ID = /^[a-z0-9][a-z0-9/_.-]{0,299}$/;

/**
 * The optional change association, as both a request and an outcome carry it.
 *
 * Absent is the ordinary case - most messages are about the thread - so it is
 * omitted rather than stored empty, and a value that is not a block id is
 * refused rather than dropped: a silently discarded association would show the
 * reviewer a conversation missing the message they just sent.
 */
const aboutBlock = (value: unknown): { readonly aboutBlockId?: string } => {
  if (value === undefined) return {};
  const blockId = text({ value, field: "aboutBlockId", limit: 300 });
  if (!BLOCK_ID.test(blockId)) {
    throw new AgentExchangeRejected('"aboutBlockId" must name a block');
  }
  return { aboutBlockId: blockId };
};

export type AgentOutcomeState =
  "answered" | "changed" | "warning" | "needs-input" | "declined";

type AgentRequestBase = TerminalAgentRequest & {
  readonly version: 3;
  readonly requestId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly premiseSnapshot: string;
  readonly createdAt: string;
  readonly baselineSnapshot?: string;
  readonly claimedAt?: string;
  readonly claimedBy?: string;
  /**
   * The connection that holds this claim, as `agent next` minted it.
   *
   * A pickup token names one lease and dies with it, and the reviewer's
   * disconnect deliberately ends that lease at once so the review frees. What
   * the claim records here outlives the release, which is what lets a decision
   * about the agent holding this work still reach that agent - and only that
   * agent - at its next command (BIG-190).
   */
  readonly claimedByConnection?: string;
  readonly claimedModel?: AgentModelIdentity;
  readonly claimExpiresAtMs?: number;
  /**
   * Rises by one on every new claim and takeover, and stays put on renewal.
   * It is what a commit proves it still owns: a superseded generation may keep
   * changing its own claim stage but can never publish it.
   */
  readonly claimGeneration?: number;
  readonly attachmentManifest: ReadonlyArray<ReviewImageAttachment>;
  readonly attachments: ReadonlyArray<ReviewImageAttachment>;
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
  /**
   * The block the reviewer was looking at when they wrote this, where they
   * wrote it about one change rather than about the thread.
   *
   * A thread carries several changes, and a reviewer standing in front of one
   * of them is not talking about the others. The block is what identifies it:
   * a place id belongs to one revision and stops naming anything the moment
   * the agent publishes the next one, while the block the change is about
   * survives being reworded again - which is exactly the conversation this
   * association has to hold together.
   */
  readonly aboutBlockId?: string;
};

export type AgentChatRequest = AgentRequestBase & {
  readonly kind: "chat";
  readonly body: string;
};

export type AgentPushRequest = AgentRequestBase & {
  readonly kind: "push";
  readonly origin: "prompt" | "about";
  readonly body: string;
  readonly threadId: string;
};

export type AgentApprovalRecordedAnswer = {
  readonly decisionId: string;
  readonly optionId: string;
};

export type AgentApprovalRequest = AgentRequestBase & {
  readonly kind: "approval";
  readonly approvalId: string;
  readonly planPath: string;
  readonly pinnedSnapshot: string;
  readonly recordedAnswers: ReadonlyArray<AgentApprovalRecordedAnswer>;
  readonly unansweredDecisions: ReadonlyArray<string>;
  readonly message: string;
};

export type AgentRequest =
  | AgentFeedbackRequest
  | AgentReplyRequest
  | AgentChatRequest
  | AgentPushRequest
  | AgentApprovalRequest;

const isPushedThreadOpener = (request: AgentRequest): boolean =>
  request.kind === "push" && request.requestId === request.threadId;

export type AgentOutcome = {
  readonly commentId: string;
  readonly state: AgentOutcomeState;
  readonly message: string;
  /**
   * The change this answers, copied from the request it answers.
   *
   * The runtime stamps it rather than the agent supplying it: an answer is
   * about whatever was asked, so making the agent repeat the association would
   * be asking it to restate a fact the runtime already holds - and would put
   * the association at risk of disagreeing with the question.
   */
  readonly aboutBlockId?: string;
  /** One scannable line, present exactly when the state is "warning". */
  readonly summary?: string;
  readonly changeTargets?: ReadonlyArray<string>;
};

type AgentResponseBase = {
  readonly version: 3;
  readonly requestId: string;
  readonly sessionId: string;
  readonly planId: string;
  /**
   * The claim generation this answer was drafted for. It is stamped from the
   * request, never from the agent, and the terminal commit re-checks it, so a
   * takeover between drafting and commit refuses the answer instead of letting
   * it publish over the new holder's work.
   */
  readonly claimGeneration: number;
  readonly resultSnapshot: string;
  readonly createdAt: string;
};

export type AgentThreadResponse = AgentResponseBase & {
  readonly kind: "feedback" | "reply" | "push";
  readonly outcomes: ReadonlyArray<AgentOutcome>;
};

export type AgentChatResponse = AgentResponseBase & {
  readonly kind: "chat";
  readonly message: string;
};

export type AgentApprovalResponse = AgentResponseBase & {
  readonly kind: "approval";
  readonly summary?: string;
  /**
   * The canonical-source check the agent could not pass, in its own words.
   *
   * An acknowledgment says the agent read the pinned revision; this says it
   * could not, which is the one other answer the handoff has. It carries its
   * own field rather than riding on a refusal, because a refused response is
   * only ever seen by the agent that wrote it, and the reviewer is the person
   * who has to act on a plan the agent will not start (BIG-131).
   */
  readonly hardStop?: string;
};

export type AgentResponse =
  AgentThreadResponse | AgentChatResponse | AgentApprovalResponse;

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

const epochMilliseconds = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new AgentExchangeRejected(
      `"${field}" must be a positive epoch millisecond count`,
    );
  }
  return value;
};

const claimGenerationNumber = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new AgentExchangeRejected(
      '"claimGeneration" must be a positive whole number',
    );
  }
  return value;
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

const migratedSnapshot = ({
  value,
  currentField,
  legacyField,
}: {
  readonly value: Readonly<Record<string, unknown>>;
  readonly currentField: string;
  readonly legacyField: string;
}): string =>
  snapshotDigest(value[currentField] ?? value[legacyField], currentField);

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
    ...(value.snapshot === undefined
      ? {}
      : {
          snapshot: snapshotDigest(value.snapshot, "target.snapshot"),
        }),
    ...(typeof value.section === "string" && value.section !== ""
      ? {
          section: text({
            value: value.section,
            field: "target.section",
            limit: 300,
          }),
        }
      : {}),
    // A slide comment addresses the slide, so the slide's content travels with
    // it. Dropping it here would hand the agent the heading and nothing else on
    // every request read back from the exchange.
    ...(typeof value.slideText === "string" && value.slideText !== ""
      ? {
          slideText: text({
            value: value.slideText,
            field: "target.slideText",
            limit: SLIDE_TEXT_LIMIT,
          }),
          isSlideTextExcerpt: value.isSlideTextExcerpt === true,
        }
      : {}),
    // A grouped slide's own text stops at its first sub-slide, so the names of
    // the sub-slides it continues into travel with it too. Without them the
    // agent reads the group's opening as the whole of what the note reaches.
    ...(Array.isArray(value.slideSubHeadings) &&
    value.slideSubHeadings.length > 0
      ? {
          slideSubHeadings: value.slideSubHeadings
            .slice(0, SLIDE_SUB_HEADING_LIMIT)
            .map((heading, index) =>
              text({
                value: heading,
                field: `target.slideSubHeadings[${index}]`,
                limit: SLIDE_SUB_HEADING_TEXT_LIMIT,
              }),
            ),
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
  const imageBlockIds =
    value.type === "selection" && Array.isArray(value.imageBlockIds)
      ? value.imageBlockIds.map((imageId, index) => {
          if (typeof imageId !== "string" || !BLOCK_ID.test(imageId)) {
            throw new AgentExchangeRejected(
              `"imageBlockIds[${index}]" must name a valid block`,
            );
          }
          return imageId;
        })
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
    value.quote.length > QUOTE_LIMIT
  ) {
    throw new AgentExchangeRejected("A stored comment range is invalid");
  }
  return {
    type: value.type,
    ...identity,
    ...(endBlockId === undefined || endBlockId === value.blockId
      ? {}
      : { endBlockId }),
    ...(imageBlockIds === undefined || imageBlockIds.length === 0
      ? {}
      : { imageBlockIds: [...new Set(imageBlockIds)] }),
    start: value.start,
    end: value.end,
    quote: value.quote,
    isQuoteExcerpt: value.isQuoteExcerpt === true,
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
    premiseSnapshot: migratedSnapshot({
      value,
      currentField: "premiseSnapshot",
      legacyField: "sourceRevision",
    }),
    target: target(value.target),
  };
};

const validateAttachments = (
  value: unknown,
  field = "attachments",
): ReadonlyArray<ReviewImageAttachment> => {
  if (!Array.isArray(value)) {
    throw new AgentExchangeRejected(`"${field}" must be an array`);
  }
  return value.map((entry) => {
    if (!isRecord(entry))
      throw new AgentExchangeRejected("An attachment must be an object");
    const { id, sha256, mimeType, byteLength, width, height, alt, path } =
      entry;
    if (!isReviewImageId(id) || !isReviewImageId(sha256) || id !== sha256) {
      throw new AgentExchangeRejected("An attachment digest is invalid");
    }
    if (
      mimeType !== "image/png" &&
      mimeType !== "image/jpeg" &&
      mimeType !== "image/webp"
    ) {
      throw new AgentExchangeRejected(
        `Attachment ${id} has an unsupported type`,
      );
    }
    if (
      typeof byteLength !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      !Number.isInteger(byteLength) ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      !isReviewImageWithinLimits({ byteLength, width, height })
    ) {
      throw new AgentExchangeRejected(
        `Attachment ${id} has invalid dimensions or size`,
      );
    }
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      !path.includes("/.big-plan/review/") ||
      !path.includes("/agent/attachments/")
    ) {
      throw new AgentExchangeRejected(`Attachment ${id} path must be absolute`);
    }
    return {
      id,
      sha256,
      alt: typeof alt === "string" ? alt : "Screenshot",
      mimeType,
      byteLength,
      width,
      height,
      path,
    };
  });
};

const validateRequestAttachments = ({
  attachmentManifest,
  attachments,
}: {
  readonly attachmentManifest: unknown;
  readonly attachments: unknown;
}): Pick<AgentRequestBase, "attachmentManifest" | "attachments"> => {
  const manifest = validateAttachments(
    attachmentManifest,
    "attachmentManifest",
  );
  const active = validateAttachments(attachments);
  if (
    new Set(manifest.map((attachment) => attachment.id)).size !==
    manifest.length
  ) {
    throw new AgentExchangeRejected(
      "The attachment manifest cannot contain duplicate images",
    );
  }
  if (
    new Set(active.map((attachment) => attachment.id)).size !== active.length
  ) {
    throw new AgentExchangeRejected(
      "Active attachments cannot contain duplicate images",
    );
  }
  const manifestById = new Map(
    manifest.map((attachment) => [attachment.id, attachment]),
  );
  for (const attachment of active) {
    const frozen = manifestById.get(attachment.id);
    if (
      frozen === undefined ||
      frozen.sha256 !== attachment.sha256 ||
      frozen.mimeType !== attachment.mimeType ||
      frozen.byteLength !== attachment.byteLength ||
      frozen.width !== attachment.width ||
      frozen.height !== attachment.height ||
      frozen.path !== attachment.path
    ) {
      throw new AgentExchangeRejected(
        `Active attachment ${attachment.id} is not in the frozen manifest`,
      );
    }
  }
  return { attachmentManifest: manifest, attachments: active };
};

const requestBase = (
  value: Readonly<Record<string, unknown>>,
): AgentRequestBase => {
  if (value.version !== 3) {
    throw new AgentExchangeRejected("Unsupported agent request version");
  }
  const rawBaselineSnapshot =
    value.baselineSnapshot ?? value.claimedFromRevision;
  const baselineSnapshot =
    rawBaselineSnapshot === undefined
      ? undefined
      : snapshotDigest(rawBaselineSnapshot, "baselineSnapshot");
  const claimedAt =
    value.claimedAt === undefined ? undefined : timestamp(value.claimedAt);
  const claimedBy =
    value.claimedBy === undefined
      ? undefined
      : id(value.claimedBy, "claimedBy");
  const claimedByConnection =
    value.claimedByConnection === undefined
      ? undefined
      : id(value.claimedByConnection, "claimedByConnection");
  const claimedModel =
    value.claimedModel === undefined
      ? undefined
      : decodeAgentModelIdentity(value.claimedModel);
  if (value.claimedModel !== undefined && claimedModel === undefined) {
    throw new AgentExchangeRejected(
      '"claimedModel" must contain a non-empty model name of at most 80 characters',
    );
  }
  const claimExpiresAtMs =
    value.claimExpiresAtMs === undefined
      ? undefined
      : epochMilliseconds(value.claimExpiresAtMs, "claimExpiresAtMs");
  const claimGeneration =
    value.claimGeneration === undefined
      ? undefined
      : claimGenerationNumber(value.claimGeneration);
  const answeredAt =
    value.answeredAt === undefined ? undefined : timestamp(value.answeredAt);
  const canceledAt =
    value.canceledAt === undefined ? undefined : timestamp(value.canceledAt);
  if (answeredAt !== undefined && canceledAt !== undefined) {
    throw new AgentExchangeRejected(
      "A request cannot be both answered and canceled",
    );
  }
  const claimFields = [
    baselineSnapshot,
    claimedAt,
    claimedBy,
    claimExpiresAtMs,
    claimGeneration,
  ];
  if (
    claimFields.some((field) => field !== undefined) !==
    claimFields.every((field) => field !== undefined)
  ) {
    throw new AgentExchangeRejected(
      '"baselineSnapshot", "claimedAt", "claimedBy", "claimExpiresAtMs", and "claimGeneration" must appear together',
    );
  }
  if (answeredAt !== undefined && baselineSnapshot === undefined) {
    throw new AgentExchangeRejected(
      "An answered request must carry a complete claim",
    );
  }
  if (claimedModel !== undefined && baselineSnapshot === undefined) {
    throw new AgentExchangeRejected('"claimedModel" requires a complete claim');
  }
  if (claimedByConnection !== undefined && baselineSnapshot === undefined) {
    throw new AgentExchangeRejected(
      '"claimedByConnection" requires a complete claim',
    );
  }
  const requestAttachments = validateRequestAttachments({
    attachmentManifest: value.attachmentManifest,
    attachments: value.attachments,
  });
  return {
    version: 3,
    requestId: id(value.requestId, "requestId"),
    sessionId: id(value.sessionId, "sessionId"),
    planId: id(value.planId, "planId"),
    premiseSnapshot: migratedSnapshot({
      value,
      currentField: "premiseSnapshot",
      legacyField: "sourceRevision",
    }),
    createdAt: timestamp(value.createdAt),
    ...(baselineSnapshot === undefined
      ? {}
      : {
          baselineSnapshot,
          claimedAt,
          claimedBy,
          claimExpiresAtMs,
          claimGeneration,
          ...(claimedByConnection === undefined ? {} : { claimedByConnection }),
          ...(claimedModel === undefined ? {} : { claimedModel }),
        }),
    ...(answeredAt === undefined ? {} : { answeredAt }),
    ...(canceledAt === undefined ? {} : { canceledAt }),
    ...requestAttachments,
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
      attachments: base.attachments,
    };
  }
  if (value.kind === "reply") {
    return {
      ...base,
      kind: "reply",
      commentId: exchangeCommentId(value.commentId, "commentId"),
      body: text({ value: value.body, field: "body" }),
      ...aboutBlock(value.aboutBlockId),
      attachments: base.attachments,
    };
  }
  if (value.kind === "chat") {
    return {
      ...base,
      kind: "chat",
      body: text({ value: value.body, field: "body" }),
      attachments: base.attachments,
    };
  }
  if (value.kind === "push") {
    if (value.origin !== "prompt" && value.origin !== "about") {
      throw new AgentExchangeRejected(
        '"origin" must be either "prompt" or "about"',
      );
    }
    if (base.attachmentManifest.length !== 0 || base.attachments.length !== 0) {
      throw new AgentExchangeRejected(
        "A push request cannot contain attachments",
      );
    }
    return {
      ...base,
      kind: "push",
      origin: value.origin,
      body: text({ value: value.body, field: "body" }),
      threadId: id(value.threadId, "threadId"),
      attachments: [],
    };
  }
  if (value.kind === "approval") {
    if (base.attachmentManifest.length !== 0 || base.attachments.length !== 0) {
      throw new AgentExchangeRejected(
        "An approval request cannot contain attachments",
      );
    }
    const approvalId = id(value.approvalId, "approvalId");
    if (approvalId !== base.requestId) {
      throw new AgentExchangeRejected('"approvalId" must match "requestId"');
    }
    const pinnedSnapshot = snapshotDigest(
      value.pinnedSnapshot,
      "pinnedSnapshot",
    );
    if (pinnedSnapshot !== base.premiseSnapshot) {
      throw new AgentExchangeRejected(
        '"premiseSnapshot" must equal "pinnedSnapshot"',
      );
    }
    const planPath = text({
      value: value.planPath,
      field: "planPath",
      limit: 4096,
    });
    if (!isAbsolute(planPath)) {
      throw new AgentExchangeRejected('"planPath" must be an absolute path');
    }
    if (!Array.isArray(value.recordedAnswers)) {
      throw new AgentExchangeRejected('"recordedAnswers" must be an array');
    }
    if (!Array.isArray(value.unansweredDecisions)) {
      throw new AgentExchangeRejected('"unansweredDecisions" must be an array');
    }
    return {
      ...base,
      kind: "approval",
      approvalId,
      planPath,
      pinnedSnapshot,
      recordedAnswers: value.recordedAnswers.map(approvalRecordedAnswer),
      unansweredDecisions: value.unansweredDecisions.map((decisionId) =>
        text({
          value: decisionId,
          field: "unansweredDecision",
          limit: 512,
        }),
      ),
      message: text({
        value: value.message,
        field: "message",
        limit: APPROVAL_MESSAGE_LIMIT,
      }),
      attachments: [],
    };
  }
  throw new AgentExchangeRejected("Unsupported agent request kind");
};

const approvalRecordedAnswer = (
  value: unknown,
): AgentApprovalRecordedAnswer => {
  if (!isRecord(value)) {
    throw new AgentExchangeRejected("Each recorded answer must be an object");
  }
  return {
    decisionId: text({
      value: value.decisionId,
      field: "decisionId",
      limit: 512,
    }),
    optionId: text({ value: value.optionId, field: "optionId", limit: 512 }),
  };
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
  version: 3,
  requestId: request.requestId,
  sessionId: request.sessionId,
  planId: request.planId,
  claimGeneration: requestClaimGeneration(request),
  resultSnapshot: currentSnapshot,
  createdAt: now,
});

const expectedCommentIds = ({
  request,
  commentsById,
}: {
  readonly request: AgentFeedbackRequest | AgentReplyRequest | AgentPushRequest;
  readonly commentsById: ReadonlyMap<string, ReviewComment>;
}): ReadonlyArray<string> => {
  if (request.kind === "feedback") {
    return request.comments.map((entry) => entry.id);
  }
  if (request.kind === "push") return [request.threadId];
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
  readonly request: AgentFeedbackRequest | AgentReplyRequest | AgentPushRequest;
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
    // Taken from the question rather than from the answer: the agent is not
    // asked to restate which change it was replying about. A feedback package
    // carries the association on the comment being answered, because there the
    // comment is the message.
    ...aboutBlock(
      request.kind === "reply"
        ? request.aboutBlockId
        : request.kind === "feedback"
          ? request.comments.find(
              (candidate) => candidate.id === checkedCommentId,
            )?.aboutBlockId
          : undefined,
    ),
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

/** Reads the generation of a claimed request, refusing an unclaimed one. */
export const requestClaimGeneration = (request: AgentRequest): number => {
  if (request.claimGeneration === undefined) {
    throw new AgentExchangeRejected(
      "The request must be claimed before its generation can be read",
    );
  }
  return request.claimGeneration;
};

const validateApprovalAcknowledgment = ({
  hardStop,
  resultSnapshot,
  pinnedSnapshot,
}: {
  readonly hardStop: string | undefined;
  readonly resultSnapshot: string;
  readonly pinnedSnapshot: string;
}): void => {
  if (hardStop === undefined && resultSnapshot !== pinnedSnapshot) {
    throw new AgentExchangeRejected(
      'An approval acknowledgment must not change the plan. Restore the source so its digest equals the pinned snapshot and respond again, or report what you found with "hardStop".',
    );
  }
};

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
  if (request.kind === "approval") {
    const hardStop =
      value.hardStop === undefined
        ? undefined
        : text({
            value: value.hardStop,
            field: "hardStop",
            limit: APPROVAL_HARD_STOP_LIMIT,
          });
    /*
    A reported hard stop is not held to the pin, because the pin is exactly what
    it says it could not reach. It is not an acknowledgment either: it publishes
    nothing and settles the request as unanswered work the reviewer must decide
    about, which is why it is opt-in rather than inferred from the digest.
    */
    validateApprovalAcknowledgment({
      hardStop,
      resultSnapshot: currentSnapshot,
      pinnedSnapshot: request.pinnedSnapshot,
    });
    const summary =
      value.summary === undefined
        ? undefined
        : text({
            value: value.summary,
            field: "summary",
            limit: WARNING_SUMMARY_LIMIT,
          });
    return {
      ...base,
      kind: "approval",
      ...(summary === undefined ? {} : { summary }),
      ...(hardStop === undefined ? {} : { hardStop }),
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
  if (
    request.kind === "push" &&
    outcomes.every((entry) => entry.state !== "changed") &&
    currentSnapshot !== requestBaselineSnapshot(request)
  ) {
    throw new AgentExchangeRejected(
      'A push with no "changed" outcome cannot revise the plan source',
    );
  }
  return { ...base, kind: request.kind, outcomes };
};

/**
 * Re-checks one stored response on its own terms, without the request it
 * answers. The prepared-transaction journal carries a response the runtime
 * later publishes with no agent present, so it is validated on the way out of
 * the file as strictly as it was on the way in.
 */
export const validateAgentResponse = (value: unknown): AgentResponse => {
  if (!isRecord(value) || value.version !== 3) {
    throw new AgentExchangeRejected("A stored agent response is invalid");
  }
  const base: AgentResponseBase = {
    version: 3,
    requestId: id(value.requestId, "requestId"),
    sessionId: id(value.sessionId, "sessionId"),
    planId: id(value.planId, "planId"),
    claimGeneration: claimGenerationNumber(value.claimGeneration),
    resultSnapshot: migratedSnapshot({
      value,
      currentField: "resultSnapshot",
      legacyField: "sourceRevision",
    }),
    createdAt: timestamp(value.createdAt),
  };
  if (value.kind === "chat") {
    return {
      ...base,
      kind: "chat",
      message: text({ value: value.message, field: "message" }),
    };
  }
  if (value.kind === "approval") {
    const summary =
      value.summary === undefined
        ? undefined
        : text({
            value: value.summary,
            field: "summary",
            limit: WARNING_SUMMARY_LIMIT,
          });
    const hardStop =
      value.hardStop === undefined
        ? undefined
        : text({
            value: value.hardStop,
            field: "hardStop",
            limit: APPROVAL_HARD_STOP_LIMIT,
          });
    return {
      ...base,
      kind: "approval",
      ...(summary === undefined ? {} : { summary }),
      ...(hardStop === undefined ? {} : { hardStop }),
    };
  }
  if (
    value.kind !== "feedback" &&
    value.kind !== "reply" &&
    value.kind !== "push"
  ) {
    throw new AgentExchangeRejected("A stored agent response is invalid");
  }
  if (!Array.isArray(value.outcomes)) {
    throw new AgentExchangeRejected("A stored outcome list is invalid");
  }
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
      ...aboutBlock(entry.aboutBlockId),
    };
    if (entry.state !== "changed") {
      return result;
    }
    // Disk state is held to the bounds the live draft path enforces, or a
    // hand-edited response could reach the viewer carrying value the runtime
    // would have refused on the way in.
    if (
      !Array.isArray(entry.changeTargets) ||
      entry.changeTargets.length === 0 ||
      entry.changeTargets.length > MESSAGE_LIMIT ||
      entry.changeTargets.some(
        (target) => typeof target !== "string" || !BLOCK_ID.test(target),
      ) ||
      new Set(entry.changeTargets).size !== entry.changeTargets.length
    ) {
      throw new AgentExchangeRejected("Stored change targets are invalid");
    }
    return { ...result, changeTargets: entry.changeTargets };
  });
  const actual = outcomes.map((entry) => entry.commentId);
  if (new Set(actual).size !== actual.length) {
    throw new AgentExchangeRejected("A stored outcome set is incomplete");
  }
  return { ...base, kind: value.kind, outcomes };
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
  if (request.answeredAt === undefined) {
    throw new AgentExchangeRejected(
      "A stored agent response has not reached its terminal commit",
    );
  }
  if (!agentOwnsRequest(request) || request.baselineSnapshot === undefined) {
    throw new AgentExchangeRejected(
      "A stored agent response cannot answer an unclaimed request",
    );
  }
  const response = validateAgentResponse(value);
  if (
    response.requestId !== request.requestId ||
    response.sessionId !== request.sessionId ||
    response.planId !== request.planId ||
    response.kind !== request.kind ||
    response.claimGeneration !== request.claimGeneration
  ) {
    throw new AgentExchangeRejected(
      "A stored agent response does not match its request",
    );
  }
  if (response.kind === "chat" || request.kind === "chat") {
    return response;
  }
  if (response.kind === "approval") {
    if (request.kind !== "approval") {
      throw new AgentExchangeRejected(
        "A stored agent response does not match its request",
      );
    }
    validateApprovalAcknowledgment({
      hardStop: response.hardStop,
      resultSnapshot: response.resultSnapshot,
      pinnedSnapshot: request.pinnedSnapshot,
    });
    return response;
  }
  if (request.kind === "approval") {
    throw new AgentExchangeRejected(
      "A stored agent response does not match its request",
    );
  }
  const expected = expectedCommentIds({ request, commentsById });
  const actual = response.outcomes.map((entry) => entry.commentId);
  if (
    expected.length !== actual.length ||
    expected.some((commentId) => !actual.includes(commentId))
  ) {
    throw new AgentExchangeRejected("A stored outcome set is incomplete");
  }
  return response;
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
    if (request.kind === "push" && !comments.has(request.threadId)) {
      comments.set(request.threadId, {
        id: request.threadId,
        body: request.body,
        createdAt: request.createdAt,
        premiseSnapshot: request.premiseSnapshot,
        target: { type: "document" },
      });
    }
  }
  return comments;
};

export const readValidatedAgentRequests = async ({
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
    const chronological = compareTimestamps(left.createdAt, right.createdAt);
    if (chronological !== 0) return chronological;
    const currentSession =
      Number(left.sessionId === sessionId) -
      Number(right.sessionId === sessionId);
    if (currentSession !== 0) return currentSession;
    return left.requestId.localeCompare(right.requestId);
  });
  return acceptedRequests;
};

/**
 * Reads validated history, reading only the response files the caller will
 * keep. Which requests have a response file comes from the response directory
 * listing, so choosing the window costs one listing rather than the reads it
 * exists to avoid.
 *
 * `retain` receives every accepted request, oldest first, and independently
 * selects the request metadata and response files the caller will keep.
 */
const readCompleteAgentExchange = async ({
  store,
  sessionId,
  planId,
  retain,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly retain?: (input: {
    readonly requests: ReadonlyArray<AgentRequest>;
    readonly answeredRequestIds: ReadonlySet<string>;
  }) => {
    readonly requestIds: ReadonlySet<string>;
    readonly responseIds: ReadonlySet<string>;
  };
}): Promise<AgentExchangeSnapshot> => {
  const requests = await readValidatedAgentRequests({
    store,
    sessionId,
    planId,
  });
  const commentsById = commentsFromRequests(requests);
  const answeredRequestIds = new Set(await listAgentResponseRequestIds(store));
  const allRequestIds = new Set(requests.map((request) => request.requestId));
  const retained =
    retain === undefined
      ? { requestIds: allRequestIds, responseIds: allRequestIds }
      : retain({ requests, answeredRequestIds });
  const retainedRequests = requests.filter((request) =>
    retained.requestIds.has(request.requestId),
  );
  const requestById = new Map(
    retainedRequests.map((request) => [request.requestId, request]),
  );
  const responses: Array<AgentResponse> = [];
  const responseRequestIds = new Set<string>();
  const readable = retainedRequests
    .map((request) => request.requestId)
    .filter(
      (requestId) =>
        retained.responseIds.has(requestId) &&
        answeredRequestIds.has(requestId) &&
        requestById.get(requestId)?.answeredAt !== undefined,
    );
  for (const value of await readAgentResponseValuesFor({
    store,
    requestIds: readable,
  })) {
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
  return { requests: retainedRequests, responses };
};

/** Returns the requests the agent still owes an answer, oldest first. */
export const outstandingAgentRequests = (
  snapshot: AgentExchangeSnapshot,
): ReadonlyArray<AgentRequest> => {
  const answered = new Set(
    snapshot.requests
      .filter((request) => request.answeredAt !== undefined)
      .map((request) => request.requestId),
  );
  const cancelPendingRequestIds = new Set<string>();
  return snapshot.requests.filter((request) =>
    requestIsOutstanding({
      request,
      answeredRequestIds: answered,
      cancelPendingRequestIds,
    }),
  );
};

/** True once a request has had its one terminal write. */
export { requestIsTerminal };

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
  version: 3,
  requestId: feedback.packageId,
  sessionId: feedback.sessionId,
  planId: feedback.planId,
  premiseSnapshot: snapshotDigest(premiseSnapshot, "premiseSnapshot"),
  createdAt: feedback.createdAt,
  kind: "feedback",
  packageId: feedback.packageId,
  comments: feedback.comments,
  attachmentManifest: feedback.attachments,
  attachments: feedback.attachments,
});

/** Turns one recorded approval into the mailbox request the agent acknowledges. */
export const approvalAgentRequest = ({
  approvalId,
  sessionId,
  planId,
  planPath,
  pinnedSnapshot,
  createdAt,
  recordedAnswers,
  unansweredDecisions,
  message,
}: {
  readonly approvalId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly planPath: string;
  readonly pinnedSnapshot: string;
  readonly createdAt: string;
  readonly recordedAnswers: ReadonlyArray<AgentApprovalRecordedAnswer>;
  readonly unansweredDecisions: ReadonlyArray<string>;
  readonly message: string;
}): AgentApprovalRequest => {
  const request = validateAgentRequest({
    version: 3,
    requestId: approvalId,
    sessionId,
    planId,
    premiseSnapshot: pinnedSnapshot,
    createdAt,
    kind: "approval",
    approvalId,
    planPath,
    pinnedSnapshot,
    recordedAnswers,
    unansweredDecisions,
    message,
    attachmentManifest: [],
    attachments: [],
  });
  if (request.kind !== "approval") {
    throw new AgentExchangeRejected("Unsupported agent request kind");
  }
  return request;
};

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
  aboutBlockId,
  attachments,
}: {
  readonly kind: "reply" | "chat";
  readonly requestId: string;
  readonly sessionId: string;
  readonly planId: string;
  readonly premiseSnapshot: string;
  readonly createdAt: string;
  readonly body: string;
  readonly commentId?: string;
  /** The change the reviewer was reviewing when they wrote this, if one. */
  readonly aboutBlockId?: string;
  readonly attachments?: ReadonlyArray<ReviewImageAttachment>;
}): AgentReplyRequest | AgentChatRequest => {
  const checkedAttachments = validateAttachments(attachments ?? []);
  const base: AgentRequestBase = {
    version: 3,
    requestId: id(requestId, "requestId"),
    sessionId: id(sessionId, "sessionId"),
    planId: id(planId, "planId"),
    premiseSnapshot: snapshotDigest(premiseSnapshot, "premiseSnapshot"),
    createdAt: timestamp(createdAt),
    attachmentManifest: checkedAttachments,
    attachments: checkedAttachments,
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
    ...aboutBlock(aboutBlockId),
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
 * Applies ADR 0002's pickup release rule: a terminal request cannot block the
 * plan, while an unterminated request blocks only for its live claim.
 */
export const requestBlocksPlanPickup = ({
  request,
  nowMs,
}: {
  readonly request: AgentRequest;
  readonly nowMs: number;
}): boolean => !requestIsTerminal(request) && claimIsLive({ request, nowMs });

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
  nowMs = Date.now(),
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly nowMs?: number;
}): Promise<AgentExchangeSnapshot> => {
  const complete = await readCompleteAgentExchange({
    store,
    sessionId,
    planId,
    retain: ({ requests }) => {
      const pending = requests.filter((request) => !requestIsTerminal(request));
      const terminal = requests
        .filter((request) => requestIsTerminal(request))
        .slice(-EXCHANGE_LIMIT);
      const pickupBlockers = requests.filter((request) =>
        requestBlocksPlanPickup({ request, nowMs }),
      );
      const pushedThreadOpeners = requests.filter(isPushedThreadOpener);
      const responseRequests = [...pending, ...terminal, ...pickupBlockers];
      return {
        requestIds: new Set(
          [...responseRequests, ...pushedThreadOpeners].map(
            (request) => request.requestId,
          ),
        ),
        responseIds: new Set(
          responseRequests.map((request) => request.requestId),
        ),
      };
    },
  });
  const pending = outstandingAgentRequests(complete);
  const pendingRequestIds = new Set(
    pending.map((request) => request.requestId),
  );
  const terminal = complete.requests
    .filter((request) => !pendingRequestIds.has(request.requestId))
    .slice(-EXCHANGE_LIMIT);
  const pickupBlockers = complete.requests.filter((request) =>
    requestBlocksPlanPickup({ request, nowMs }),
  );
  const pushedThreadOpeners = complete.requests.filter(isPushedThreadOpener);
  const retainedRequestIds = new Set(
    [...pending, ...terminal, ...pickupBlockers, ...pushedThreadOpeners].map(
      (request) => request.requestId,
    ),
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
  const forComment = (request: AgentRequest): boolean =>
    (request.kind === "feedback" &&
      request.comments.some((comment) => comment.id === commentId)) ||
    (request.kind === "reply" && request.commentId === commentId) ||
    (request.kind === "push" && request.threadId === commentId);
  const complete = await readCompleteAgentExchange({
    store,
    sessionId,
    planId,
    // This history answers questions about one comment, so the responses of
    // every other comment's requests are read for nothing.
    retain: ({ requests }) => {
      const requestIds = new Set(
        requests.filter(forComment).map((request) => request.requestId),
      );
      return { requestIds, responseIds: requestIds };
    },
  });
  const requests = complete.requests.filter(forComment);
  const requestIds = new Set(requests.map((request) => request.requestId));
  return {
    requests,
    responses: complete.responses.filter((response) =>
      requestIds.has(response.requestId),
    ),
  };
};

/**
 * Reads the responses the named requests produced, from the whole persisted
 * history rather than the bounded window the reader is served.
 *
 * A committed revision names the request that published it, and a request that
 * scrolled out of that window still published bytes the diff is showing, so
 * anything that joins revisions back to what the agent declared has to be able
 * to reach it.
 */
export const readAgentResponsesFor = async ({
  store,
  sessionId,
  planId,
  requestIds,
}: {
  readonly store: ReviewStore;
  readonly sessionId: string;
  readonly planId: string;
  readonly requestIds: ReadonlySet<string>;
}): Promise<ReadonlyArray<AgentResponse>> => {
  const complete = await readCompleteAgentExchange({
    store,
    sessionId,
    planId,
    retain: () => ({ requestIds, responseIds: requestIds }),
  });
  return complete.responses.filter((response) =>
    requestIds.has(response.requestId),
  );
};

/** Reads one response only when its complete persisted shape is valid. */
export const readValidatedAgentResponse = async ({
  store,
  request,
}: {
  readonly store: ReviewStore;
  readonly request: AgentRequest;
}): Promise<AgentResponse | undefined> => {
  const requests = await readValidatedAgentRequests({
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

/**
 * Returns the oldest request available for a new plan-wide claim.
 */
export const nextPendingAgentRequest = (
  snapshot: AgentExchangeSnapshot,
  viewer: { readonly claimedBy: string; readonly nowMs: number },
): AgentRequest | undefined => {
  if (
    snapshot.requests.some((request) =>
      requestBlocksPlanPickup({ request, nowMs: viewer.nowMs }),
    )
  ) {
    return undefined;
  }
  return outstandingAgentRequests(snapshot).find(
    (request) =>
      !claimIsHeldByAnother({
        request,
        claimedBy: viewer.claimedBy,
        nowMs: viewer.nowMs,
      }),
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
  if (request.kind === "approval") {
    return { requestId: request.requestId };
  }
  const commentIds =
    request.kind === "feedback"
      ? request.comments.map((entry) => entry.id)
      : request.kind === "push"
        ? [request.threadId]
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
