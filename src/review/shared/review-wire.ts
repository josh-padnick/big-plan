// Owns the loopback review runtime's browser-safe JSON contract. Server
// encoders and browser decoders meet here so transport changes cannot drift.

import { isStoredCommentTarget, type ReviewComment } from "./comment.js";
import {
  PLACE_ID_LIMIT,
  SNAPSHOT_DIGEST,
  type ChangeDisposition,
  type ChangeDispositionState,
} from "./change-disposition.js";
import {
  decodeAgentModelIdentity,
  type AgentModelIdentity,
} from "./agent-model.js";
import type { TerminalAgentRequest } from "./agent-request-state.js";
import { isProgressStepCode, type ProgressStepCode } from "./progress-code.js";
import {
  type ReviewInput,
  type ReviewInputContract,
  type ReviewInputState,
} from "./input-contract.js";

export type ReviewSnapshot = {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly sent: ReadonlyArray<ReviewComment>;
  readonly resolvedCommentIds: ReadonlyArray<string>;
  /**
   * The store content this snapshot was read from, named so a later write can
   * be conditional on it. An empty version means the reader has no claim to
   * make, and a write carrying it is refused rather than applied blindly.
   */
  readonly version: string;
};

/**
 * The code a refused conditional drafts write carries. A status alone cannot
 * name this refusal, because a read-only replaced session refuses with 409 too
 * and the browser must answer the two differently.
 */
export const STALE_REVIEW_STATE_CODE = "stale-review-state";

export type StagedDecisionAnswer = {
  readonly decisionId: string;
  readonly optionId: string;
  readonly optionTitle: string;
  readonly prompt: string;
  readonly answeredAt: string;
  readonly premiseSnapshot: string;
  // The digest of the decision this answered, stamped by the server from the
  // compiled plan. An answer is current only while it still matches, so the
  // reviewer's confirmation can never migrate onto edited content.
  readonly decisionDigest: string;
};

export type ReviewState = {
  readonly answers: ReadonlyArray<StagedDecisionAnswer>;
  // Decisions the plan still asks that hold an answer to content they no longer
  // have. The reader gave that answer and deserves to be told it stopped
  // applying, which a card cannot work out for itself: from the browser's side
  // a masked answer and an unanswered decision look identical.
  readonly supersededDecisionIds: ReadonlyArray<string>;
  // Monotonic across every accepted write to the answers store. The browser
  // applies a response only when this is newer than the last one it applied,
  // so an in-flight read can no longer land on top of a completed write.
  readonly revision: number;
};

export type AgentOutcome = {
  readonly commentId: string;
  readonly state:
    "answered" | "changed" | "warning" | "needs-input" | "declined";
  readonly message: string;
  /** One scannable line, published exactly when the state is "warning". */
  readonly summary?: string;
  readonly changeTargets: ReadonlyArray<string>;
};

export type AgentRequest = TerminalAgentRequest & {
  readonly requestId: string;
  readonly premiseSnapshot: string;
  readonly baselineSnapshot?: string;
  readonly claimedAt?: string;
  readonly claimedBy?: string;
  readonly claimedModel?: AgentModelIdentity;
  readonly claimExpiresAtMs?: number;
  readonly createdAt: string;
  readonly kind: "feedback" | "reply" | "chat" | "push";
  readonly body?: string;
  readonly commentId?: string;
  readonly commentIds: ReadonlyArray<string>;
  readonly origin?: "prompt" | "about";
  readonly threadId?: string;
  readonly targetLabel?: string;
};

export type AgentResponse = {
  readonly requestId: string;
  readonly resultSnapshot: string;
  readonly createdAt: string;
  readonly kind: "feedback" | "reply" | "chat" | "push";
  readonly outcomes: ReadonlyArray<AgentOutcome>;
  readonly message?: string;
};

export type AgentPresence = {
  readonly connected: boolean;
  readonly state: "waiting" | "working";
  readonly requestId?: string;
  /** Which model is running the attached connector, claim or no claim. */
  readonly model?: AgentModelIdentity;
  readonly updatedAtMs?: number;
  /** When the agent's own loop reported the session ending, if it did. */
  readonly endedAtMs?: number;
  /**
   * When the reviewer disconnected this agent, if they did.
   *
   * It is carried only while the directive still addresses the agent the
   * presence record names, so a disconnect answered by one agent never reports
   * itself against the next one to attach (BIG-190).
   */
  readonly disconnectRequestedAtMs?: number;
};

export type BrowserConnectionEvent = {
  readonly eventId?: string;
  readonly connected: boolean;
  readonly at: string;
  readonly reason?: string;
};

export type AgentSnapshot = {
  readonly currentSnapshot: string;
  readonly presence: AgentPresence;
  readonly requests: ReadonlyArray<AgentRequest>;
  readonly responses: ReadonlyArray<AgentResponse>;
  readonly connectionLog: ReadonlyArray<BrowserConnectionEvent>;
  readonly plan: string;
  readonly agentCommand: string;
  readonly recoveryPrompt: string;
};

export type ProgressEvent = {
  readonly requestId?: string;
  readonly atMs?: number;
  readonly seq: number;
  readonly stepCode: ProgressStepCode;
  readonly step: string;
  readonly state: "waiting" | "live" | "done" | "failed";
  readonly detail?: string;
};

export type DiffRun = {
  readonly op: "same" | "del" | "ins";
  readonly text: string;
};

// The meaning-bearing presentation facts the renderer stamped for one block,
// carried per diff side so the lens replays each side from its own snapshot
// instead of sniffing the live document. Only a fact that changes what the plan
// asserts belongs here - a callout's type, a list's ordering, a wireframe's
// initial screen, or a picture's source and alternative words. Styling and
// other reproducible presentation must never join this contract.
// Mirrored by hand across the reviewShared tier boundary; reviewShared may
// import nothing - keep this in sync with src/render/markdown/block-identity.ts.
export type BlockPresentation =
  | {
      readonly aspect: "callout";
      readonly calloutType: "note" | "tip" | "warning" | "danger";
    }
  | { readonly aspect: "list"; readonly isOrdered: boolean }
  | { readonly aspect: "wireframe"; readonly currentScreenId: string }
  | { readonly aspect: "image"; readonly source: string; readonly alt: string };

export type DiffLocation = {
  readonly status: "changed" | "added" | "removed";
  readonly scope: string;
  readonly oldBlockId?: string;
  readonly newBlockId?: string;
  readonly beforeBlockId?: string;
  readonly afterBlockId?: string;
  readonly kind: string;
  readonly label: string;
  readonly section: string;
  readonly oldText: string;
  readonly newText: string;
  readonly oldPresentation?: BlockPresentation;
  readonly newPresentation?: BlockPresentation;
  readonly oldTableHeaders?: ReadonlyArray<string>;
  readonly newTableHeaders?: ReadonlyArray<string>;
  readonly isTableHeader?: boolean;
  readonly runs: ReadonlyArray<DiffRun>;
  readonly oldHtml?: string;
  readonly newHtml?: string;
};

export type DiffPlace = {
  readonly placeId: string;
  readonly status: "changed" | "added" | "removed";
  readonly label: string;
  readonly section: string;
  readonly note: "reworded" | "rewritten" | "replaced" | "added" | "removed";
  readonly locationIndexes: ReadonlyArray<number>;
};

export type SnapshotDiff = {
  readonly from: string;
  readonly to: string;
  readonly locations: ReadonlyArray<DiffLocation>;
  readonly places: ReadonlyArray<DiffPlace>;
};

export type RuntimeSession = {
  readonly plan: string;
  readonly authoritative: boolean;
  readonly latestReviewUrl?: string;
  readonly restartCommand?: string;
  /**
   * How long this runtime's oldest stalled write has been stuck, present only
   * while one is. Every route the page polls is a read, and reads keep
   * answering through a runtime that has stopped accepting changes, so this is
   * the only fact that can tell the reader the session went one-way.
   */
  readonly writesStalledMs?: number;
  /** How long this session survives with nobody reading and nobody working. */
  readonly idleTimeoutMs?: number;
  /** When it ends unless something touches it. Absent when nothing expires. */
  readonly expiresAtMs?: number;
};

export type ReviewSnapshotSource = ReviewSnapshot;

export type ReviewStateSource = ReviewState;

export type ChangeDispositionStateSource = ChangeDispositionState;

export type AgentSnapshotSource = {
  readonly currentSnapshot: string;
  readonly presence: unknown;
  readonly requests: ReadonlyArray<unknown>;
  readonly responses: ReadonlyArray<unknown>;
  readonly connectionLog: ReadonlyArray<unknown>;
  readonly plan: string;
  readonly agentCommand: string;
  readonly recoveryPrompt: string;
};

export type RuntimeSessionSource = {
  readonly sessionId: string;
  readonly planId: string;
  readonly plan: string;
  readonly authoritative: boolean;
  readonly latestReviewUrl?: string;
  readonly restartCommand?: string;
  readonly writesStalledMs?: number;
  readonly idleTimeoutMs?: number;
  readonly expiresAtMs?: number;
};

export const isReviewWireRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isWireTimestamp = (value: unknown): value is string =>
  typeof value === "string" && !Number.isNaN(Date.parse(value));

/** Recognizes the bounded comment identity needed by browser persistence. */
export const isReviewCommentValue = (
  value: unknown,
): value is ReviewComment => {
  if (!isReviewWireRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.body === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.premiseSnapshot === "string" &&
    isStoredCommentTarget(value.target)
  );
};

// A slide-anchored target carries a copy of its slide for the agent's brief.
// The browser is reading that slide already, so sending the copy back to it
// would grow the bootstrap by one slide per comment for no reader-visible gain.
// The server keeps the copy: it re-mints it from the block map for a new
// target and preserves it for one it already accepted, so a comment that
// returns from the browser without it loses nothing.
const withoutSlideCopy = (comment: ReviewComment): ReviewComment => {
  if (
    comment.target.type === "document" ||
    comment.target.slideText === undefined
  ) {
    return comment;
  }
  const {
    slideText: _slideText,
    isSlideTextExcerpt: _excerpt,
    slideSubHeadings: _subHeadings,
    ...target
  } = comment.target;
  return { ...comment, target };
};

/**
 * Strips the same slide copy from the comments a pending request carries.
 *
 * A request holds the comments that produced it, so the copy would otherwise
 * reach the browser here too - on every poll rather than once at load - and the
 * browser projection keeps only the comment ids. The agent reads the exchange
 * from the store, never through this encoder, so what it is handed is untouched.
 */
export const encodeAgentRequests = (
  requests: ReadonlyArray<unknown>,
): ReadonlyArray<unknown> =>
  requests.map((request) => {
    if (!isReviewWireRecord(request) || !Array.isArray(request.comments)) {
      return request;
    }
    return {
      ...request,
      comments: request.comments.map((comment) =>
        isReviewCommentValue(comment) ? withoutSlideCopy(comment) : comment,
      ),
    };
  });

/** Encodes the server-owned comment snapshot for transport. */
export const encodeReviewSnapshot = (
  value: ReviewSnapshotSource,
): ReviewSnapshotSource => ({
  ...value,
  drafts: value.drafts.map(withoutSlideCopy),
  sent: value.sent.map(withoutSlideCopy),
});

/**
 * Decodes comments while dropping malformed local or transport values. Fields
 * this contract no longer names are dropped, so state a runtime of another
 * vintage left behind loads as the fields this one understands.
 */
export const decodeReviewSnapshot = (value: unknown): ReviewSnapshot => {
  if (!isReviewWireRecord(value)) {
    return { drafts: [], sent: [], resolvedCommentIds: [], version: "" };
  }
  return {
    drafts: Array.isArray(value.drafts)
      ? value.drafts.filter(isReviewCommentValue)
      : [],
    sent: Array.isArray(value.sent)
      ? value.sent.filter(isReviewCommentValue)
      : [],
    resolvedCommentIds: Array.isArray(value.resolvedCommentIds)
      ? value.resolvedCommentIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    version: typeof value.version === "string" ? value.version : "",
  };
};

/**
 * A record's write count as a reader may use it. Every store advances this by
 * whole steps from zero, so a value that is not a whole count is not a write
 * this build can order against - and accepting one would be worse than
 * refusing it: a fractional revision sits above the legitimate write that
 * follows it, and would silently discard every later response until the count
 * climbed past it. Anything unusable decodes to -1, which is older than any
 * accepted write and can therefore never displace applied state.
 */
const storedRevision = (candidate: unknown): number =>
  typeof candidate === "number" &&
  Number.isSafeInteger(candidate) &&
  candidate >= 0
    ? candidate
    : -1;

/** Encodes the change dispositions a review has recorded. */
export const encodeChangeDispositions = (
  value: ChangeDispositionStateSource,
): ChangeDispositionStateSource => value;

/**
 * Decodes recorded dispositions while dropping malformed transport entries.
 * An unusable revision decodes to -1 for the same reason the answers store
 * does: it is older than any accepted write, so a body this build cannot read
 * can never displace state the page already applied.
 */
export const decodeChangeDispositions = (
  value: unknown,
): ChangeDispositionState => {
  if (!isReviewWireRecord(value) || !Array.isArray(value.accepted)) {
    return { accepted: [], revision: -1 };
  }
  return {
    revision: storedRevision(value.revision),
    accepted: value.accepted.flatMap(
      (entry): ReadonlyArray<ChangeDisposition> =>
        isReviewWireRecord(entry) &&
        typeof entry.from === "string" &&
        SNAPSHOT_DIGEST.test(entry.from) &&
        typeof entry.to === "string" &&
        SNAPSHOT_DIGEST.test(entry.to) &&
        typeof entry.placeId === "string" &&
        entry.placeId !== "" &&
        entry.placeId.length <= PLACE_ID_LIMIT &&
        typeof entry.acceptedAt === "string"
          ? [
              {
                from: entry.from,
                to: entry.to,
                placeId: entry.placeId,
                acceptedAt: entry.acceptedAt,
              },
            ]
          : [],
    ),
  };
};

/** Encodes the review's derived input contract for transport. */
export const encodeReviewInputContract = (
  value: ReviewInputContract,
): ReviewInputContract => value;

const INPUT_STATES: ReadonlySet<string> = new Set<ReviewInputState>([
  "answered",
  "unanswered",
  "stale",
]);

/**
 * Decodes the input contract, or says it could not.
 *
 * A body this build cannot read is reported as unreadable rather than as an
 * empty contract, because the two mean opposite things to a reader: one says
 * nobody could answer what the review needs, the other says the review needs
 * nothing. A revision it cannot order on is unreadable for the same reason -
 * the guard that drops older responses cannot hold a body it cannot place, and
 * the first read would otherwise slip past it and present as a definite answer.
 */
export const decodeReviewInputContract = (
  value: unknown,
): ReviewInputContract | undefined => {
  if (!isReviewWireRecord(value) || !Array.isArray(value.inputs)) {
    return undefined;
  }
  const revision = storedRevision(value.revision);
  if (revision < 0) return undefined;
  return {
    revision,
    inputs: value.inputs.flatMap((input): ReadonlyArray<ReviewInput> =>
      isReviewWireRecord(input) &&
      typeof input.inputId === "string" &&
      typeof input.label === "string" &&
      typeof input.isCritical === "boolean" &&
      typeof input.state === "string" &&
      INPUT_STATES.has(input.state) &&
      typeof input.detail === "string"
        ? [
            {
              inputId: input.inputId,
              label: input.label,
              isCritical: input.isCritical,
              state: input.state as ReviewInputState,
              detail: input.detail,
            },
          ]
        : [],
    ),
  };
};

/** Encodes the durable browser-safe facts gathered during plan review. */
export const encodeReviewState = (
  value: ReviewStateSource,
): ReviewStateSource => value;

/**
 * Decodes staged answers while dropping malformed transport entries. A body
 * without a usable revision decodes to -1, which is older than any accepted
 * write, so an unreadable response can never displace applied state.
 */
export const decodeReviewState = (value: unknown): ReviewState => {
  if (!isReviewWireRecord(value) || !Array.isArray(value.answers)) {
    return { answers: [], supersededDecisionIds: [], revision: -1 };
  }
  return {
    revision: storedRevision(value.revision),
    supersededDecisionIds: Array.isArray(value.supersededDecisionIds)
      ? value.supersededDecisionIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    answers: value.answers.flatMap(
      (answer): ReadonlyArray<StagedDecisionAnswer> =>
        isReviewWireRecord(answer) &&
        typeof answer.decisionId === "string" &&
        typeof answer.optionId === "string" &&
        typeof answer.optionTitle === "string" &&
        typeof answer.prompt === "string" &&
        typeof answer.answeredAt === "string" &&
        typeof answer.premiseSnapshot === "string" &&
        typeof answer.decisionDigest === "string"
          ? [
              {
                decisionId: answer.decisionId,
                optionId: answer.optionId,
                optionTitle: answer.optionTitle,
                prompt: answer.prompt,
                answeredAt: answer.answeredAt,
                premiseSnapshot: answer.premiseSnapshot,
                decisionDigest: answer.decisionDigest,
              },
            ]
          : [],
    ),
  };
};

export const emptyAgentSnapshot = (): AgentSnapshot => ({
  currentSnapshot: "",
  presence: { connected: false, state: "waiting" },
  requests: [],
  responses: [],
  connectionLog: [],
  plan: "",
  agentCommand: "",
  recoveryPrompt: "",
});

/** Encodes the runtime-owned exchange in the shape consumed by the browser. */
export const encodeAgentSnapshot = (
  value: AgentSnapshotSource,
): AgentSnapshotSource => ({
  ...value,
  requests: encodeAgentRequests(value.requests),
});

/** Decodes the agent exchange while preserving only browser-safe facts. */
export const decodeAgentSnapshot = (value: unknown): AgentSnapshot => {
  if (!isReviewWireRecord(value)) return emptyAgentSnapshot();
  const requests = Array.isArray(value.requests)
    ? value.requests.flatMap((request): ReadonlyArray<AgentRequest> => {
        if (
          !isReviewWireRecord(request) ||
          typeof request.requestId !== "string" ||
          typeof request.premiseSnapshot !== "string" ||
          typeof request.createdAt !== "string" ||
          (request.kind !== "feedback" &&
            request.kind !== "reply" &&
            request.kind !== "chat" &&
            request.kind !== "push") ||
          (request.kind === "push" &&
            ((request.origin !== "prompt" && request.origin !== "about") ||
              typeof request.body !== "string" ||
              request.body.trim() === "" ||
              request.body.length > 4000 ||
              typeof request.threadId !== "string" ||
              !/^[a-f0-9]{16}$/u.test(request.threadId)))
        ) {
          return [];
        }
        const rawClaim = [
          request.baselineSnapshot,
          request.claimedAt,
          request.claimedBy,
          request.claimExpiresAtMs,
        ];
        const hasAnyClaim = rawClaim.some((field) => field !== undefined);
        const hasCompleteClaim =
          typeof request.baselineSnapshot === "string" &&
          /^[a-f0-9]{16,64}$/.test(request.baselineSnapshot) &&
          isWireTimestamp(request.claimedAt) &&
          typeof request.claimedBy === "string" &&
          /^[a-f0-9]{16}$/.test(request.claimedBy) &&
          typeof request.claimExpiresAtMs === "number" &&
          Number.isSafeInteger(request.claimExpiresAtMs) &&
          request.claimExpiresAtMs > 0;
        const claimedModel = decodeAgentModelIdentity(request.claimedModel);
        const answeredAt = isWireTimestamp(request.answeredAt)
          ? request.answeredAt
          : undefined;
        const canceledAt = isWireTimestamp(request.canceledAt)
          ? request.canceledAt
          : undefined;
        if (
          (hasAnyClaim && !hasCompleteClaim) ||
          (request.claimedModel !== undefined &&
            (claimedModel === undefined || !hasCompleteClaim)) ||
          (request.answeredAt !== undefined && answeredAt === undefined) ||
          (request.canceledAt !== undefined && canceledAt === undefined) ||
          (answeredAt !== undefined && canceledAt !== undefined) ||
          (answeredAt !== undefined && !hasCompleteClaim)
        ) {
          return [];
        }
        const pushOrigin =
          request.origin === "prompt" || request.origin === "about"
            ? request.origin
            : undefined;
        const pushThreadId =
          typeof request.threadId === "string" ? request.threadId : undefined;
        return [
          {
            requestId: request.requestId,
            premiseSnapshot: request.premiseSnapshot,
            createdAt: request.createdAt,
            kind: request.kind,
            ...(hasCompleteClaim
              ? {
                  baselineSnapshot: request.baselineSnapshot as string,
                  claimedAt: request.claimedAt as string,
                  claimedBy: request.claimedBy as string,
                  claimExpiresAtMs: request.claimExpiresAtMs as number,
                  ...(claimedModel === undefined ? {} : { claimedModel }),
                }
              : {}),
            ...(answeredAt === undefined ? {} : { answeredAt }),
            ...(canceledAt === undefined ? {} : { canceledAt }),
            ...(typeof request.body === "string" ? { body: request.body } : {}),
            ...(typeof request.commentId === "string"
              ? { commentId: request.commentId }
              : {}),
            ...(request.kind === "push" &&
            pushOrigin !== undefined &&
            pushThreadId !== undefined
              ? { origin: pushOrigin, threadId: pushThreadId }
              : {}),
            commentIds:
              request.kind === "push" && pushThreadId !== undefined
                ? [pushThreadId]
                : Array.isArray(request.comments)
                  ? request.comments.flatMap(
                      (comment): ReadonlyArray<string> =>
                        isReviewWireRecord(comment) &&
                        typeof comment.id === "string"
                          ? [comment.id]
                          : [],
                    )
                  : [],
            ...(Array.isArray(request.comments) &&
            isReviewWireRecord(request.comments[0]) &&
            isReviewWireRecord(request.comments[0].target)
              ? {
                  targetLabel:
                    typeof request.comments[0].target.section === "string"
                      ? request.comments[0].target.section
                      : typeof request.comments[0].target.label === "string"
                        ? request.comments[0].target.label
                        : "Whole plan",
                }
              : {}),
          },
        ];
      })
    : [];
  const responses = Array.isArray(value.responses)
    ? value.responses.flatMap((response): ReadonlyArray<AgentResponse> => {
        if (
          !isReviewWireRecord(response) ||
          typeof response.requestId !== "string" ||
          typeof response.resultSnapshot !== "string" ||
          typeof response.createdAt !== "string" ||
          (response.kind !== "feedback" &&
            response.kind !== "reply" &&
            response.kind !== "chat" &&
            response.kind !== "push")
        ) {
          return [];
        }
        const outcomes = Array.isArray(response.outcomes)
          ? response.outcomes.flatMap(
              (outcome): ReadonlyArray<AgentOutcome> => {
                if (
                  !isReviewWireRecord(outcome) ||
                  typeof outcome.commentId !== "string" ||
                  typeof outcome.message !== "string" ||
                  (outcome.state !== "answered" &&
                    outcome.state !== "changed" &&
                    outcome.state !== "warning" &&
                    outcome.state !== "needs-input" &&
                    outcome.state !== "declined")
                ) {
                  return [];
                }
                return [
                  {
                    commentId: outcome.commentId,
                    state: outcome.state,
                    message: outcome.message,
                    ...(typeof outcome.summary === "string"
                      ? { summary: outcome.summary }
                      : {}),
                    changeTargets: Array.isArray(outcome.changeTargets)
                      ? outcome.changeTargets.filter(
                          (target): target is string =>
                            typeof target === "string",
                        )
                      : [],
                  },
                ];
              },
            )
          : [];
        return [
          {
            requestId: response.requestId,
            resultSnapshot: response.resultSnapshot,
            createdAt: response.createdAt,
            kind: response.kind,
            outcomes,
            ...(typeof response.message === "string"
              ? { message: response.message }
              : {}),
          },
        ];
      })
    : [];
  const presence = isReviewWireRecord(value.presence)
    ? {
        connected: value.presence.connected === true,
        state:
          value.presence.state === "working"
            ? ("working" as const)
            : ("waiting" as const),
        ...(typeof value.presence.requestId === "string"
          ? { requestId: value.presence.requestId }
          : {}),
        ...(() => {
          const model = decodeAgentModelIdentity(value.presence.model);
          return model === undefined ? {} : { model };
        })(),
        ...(typeof value.presence.updatedAtMs === "number"
          ? { updatedAtMs: value.presence.updatedAtMs }
          : {}),
        ...(typeof value.presence.endedAtMs === "number"
          ? { endedAtMs: value.presence.endedAtMs }
          : {}),
        ...(typeof value.presence.disconnectRequestedAtMs === "number"
          ? { disconnectRequestedAtMs: value.presence.disconnectRequestedAtMs }
          : {}),
      }
    : { connected: false, state: "waiting" as const };
  return {
    currentSnapshot:
      typeof value.currentSnapshot === "string" ? value.currentSnapshot : "",
    presence,
    requests,
    responses,
    connectionLog: Array.isArray(value.connectionLog)
      ? value.connectionLog.flatMap(
          (event): ReadonlyArray<BrowserConnectionEvent> =>
            isReviewWireRecord(event) &&
            typeof event.connected === "boolean" &&
            typeof event.at === "string"
              ? [
                  {
                    connected: event.connected,
                    at: event.at,
                    ...(typeof event.eventId === "string"
                      ? { eventId: event.eventId }
                      : {}),
                    ...(typeof event.reason === "string"
                      ? { reason: event.reason }
                      : {}),
                  },
                ]
              : [],
        )
      : [],
    plan: typeof value.plan === "string" ? value.plan : "",
    agentCommand:
      typeof value.agentCommand === "string" ? value.agentCommand : "",
    recoveryPrompt:
      typeof value.recoveryPrompt === "string" ? value.recoveryPrompt : "",
  };
};

/** Encodes mailbox-owned progress without presentation-specific projection. */
export const encodeProgress = ({
  events,
}: {
  readonly events: ReadonlyArray<ProgressEvent>;
}): { readonly events: ReadonlyArray<ProgressEvent> } => ({ events });

/** Decodes progress and drops unknown semantic codes or states. */
export const decodeProgress = (
  value: unknown,
): ReadonlyArray<ProgressEvent> => {
  if (!isReviewWireRecord(value) || !Array.isArray(value.events)) return [];
  return value.events.flatMap((event): ReadonlyArray<ProgressEvent> => {
    if (
      !isReviewWireRecord(event) ||
      typeof event.seq !== "number" ||
      !isProgressStepCode(event.stepCode) ||
      typeof event.step !== "string" ||
      (event.state !== "waiting" &&
        event.state !== "live" &&
        event.state !== "done" &&
        event.state !== "failed")
    ) {
      return [];
    }
    return [
      {
        seq: event.seq,
        stepCode: event.stepCode,
        step: event.step,
        state: event.state,
        ...(typeof event.requestId === "string"
          ? { requestId: event.requestId }
          : {}),
        ...(typeof event.atMs === "number" ? { atMs: event.atMs } : {}),
        ...(typeof event.detail === "string" ? { detail: event.detail } : {}),
      },
    ];
  });
};

const isUsableTimeValue = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Encodes the server's browser-safe session-authority projection. */
export const encodeRuntimeSession = (
  value: RuntimeSessionSource,
): RuntimeSessionSource => value;

/** Decodes session authority only for the page's own session identity. */
export const decodeRuntimeSession = ({
  value,
  sessionId,
}: {
  readonly value: unknown;
  readonly sessionId: string;
}): RuntimeSession | null => {
  if (
    !isReviewWireRecord(value) ||
    value.sessionId !== sessionId ||
    typeof value.plan !== "string"
  ) {
    return null;
  }
  return {
    plan: value.plan,
    // A malformed payload must withhold authority, not grant it: `!== false`
    // read a missing field, a null, and the string "false" as authoritative.
    authoritative: value.authoritative === true,
    ...(typeof value.latestReviewUrl === "string"
      ? { latestReviewUrl: value.latestReviewUrl }
      : {}),
    ...(typeof value.restartCommand === "string" &&
    value.restartCommand.trim() !== ""
      ? { restartCommand: value.restartCommand }
      : {}),
    // A stall is only ever reported as a positive age. Anything else is not a
    // smaller stall, it is an absent one, and must not raise the banner.
    ...(typeof value.writesStalledMs === "number" &&
    Number.isFinite(value.writesStalledMs) &&
    value.writesStalledMs > 0
      ? { writesStalledMs: value.writesStalledMs }
      : {}),
    // A lifetime fact the page cannot trust is worse than none: dropping it
    // leaves the reader with no promise instead of a wrong one.
    ...(isUsableTimeValue(value.idleTimeoutMs)
      ? { idleTimeoutMs: value.idleTimeoutMs }
      : {}),
    ...(isUsableTimeValue(value.expiresAtMs)
      ? { expiresAtMs: value.expiresAtMs }
      : {}),
  };
};

/** Encodes one complete snapshot diff for browser change surfaces. */
export const encodeSnapshotDiff = (value: SnapshotDiff): SnapshotDiff => value;

// Normalizes one per-side presentation fact. An unknown aspect or an
// out-of-vocabulary value decodes to undefined so the browser renders its
// neutral fallback; coercing to "note" or "unordered" here would reintroduce
// the silent downgrade this fact exists to remove.
const decodeBlockPresentation = (
  value: unknown,
): BlockPresentation | undefined => {
  if (!isReviewWireRecord(value)) return undefined;
  if (
    value.aspect === "callout" &&
    (value.calloutType === "note" ||
      value.calloutType === "tip" ||
      value.calloutType === "warning" ||
      value.calloutType === "danger")
  ) {
    return { aspect: "callout", calloutType: value.calloutType };
  }
  if (value.aspect === "list" && typeof value.isOrdered === "boolean") {
    return { aspect: "list", isOrdered: value.isOrdered };
  }
  if (
    value.aspect === "wireframe" &&
    typeof value.currentScreenId === "string" &&
    value.currentScreenId !== ""
  ) {
    return {
      aspect: "wireframe",
      currentScreenId: value.currentScreenId,
    };
  }
  if (
    value.aspect === "image" &&
    typeof value.source === "string" &&
    typeof value.alt === "string"
  ) {
    return { aspect: "image", source: value.source, alt: value.alt };
  }
  return undefined;
};

/** Decodes the bounded snapshot-diff vocabulary used by the browser. */
export const decodeSnapshotDiff = (value: unknown): SnapshotDiff | null => {
  if (
    !isReviewWireRecord(value) ||
    typeof value.from !== "string" ||
    typeof value.to !== "string" ||
    !Array.isArray(value.locations) ||
    !Array.isArray(value.places)
  ) {
    return null;
  }
  const locations = value.locations.flatMap(
    (location): ReadonlyArray<DiffLocation> => {
      if (
        !isReviewWireRecord(location) ||
        (location.status !== "changed" &&
          location.status !== "added" &&
          location.status !== "removed") ||
        typeof location.label !== "string" ||
        typeof location.section !== "string" ||
        typeof location.scope !== "string" ||
        typeof location.kind !== "string" ||
        typeof location.oldText !== "string" ||
        typeof location.newText !== "string" ||
        !Array.isArray(location.runs)
      ) {
        return [];
      }
      const runs = location.runs.flatMap((run): ReadonlyArray<DiffRun> => {
        if (
          !isReviewWireRecord(run) ||
          (run.op !== "same" && run.op !== "del" && run.op !== "ins") ||
          typeof run.text !== "string"
        ) {
          return [];
        }
        return [{ op: run.op, text: run.text }];
      });
      const oldPresentation = decodeBlockPresentation(location.oldPresentation);
      const newPresentation = decodeBlockPresentation(location.newPresentation);
      return [
        {
          status: location.status,
          scope: location.scope,
          kind: location.kind,
          label: location.label,
          section: location.section,
          oldText: location.oldText,
          newText: location.newText,
          ...(oldPresentation === undefined ? {} : { oldPresentation }),
          ...(newPresentation === undefined ? {} : { newPresentation }),
          ...(Array.isArray(location.oldTableHeaders) &&
          location.oldTableHeaders.every((entry) => typeof entry === "string")
            ? { oldTableHeaders: location.oldTableHeaders }
            : {}),
          ...(Array.isArray(location.newTableHeaders) &&
          location.newTableHeaders.every((entry) => typeof entry === "string")
            ? { newTableHeaders: location.newTableHeaders }
            : {}),
          ...(location.isTableHeader === true ? { isTableHeader: true } : {}),
          ...(typeof location.oldBlockId === "string"
            ? { oldBlockId: location.oldBlockId }
            : {}),
          ...(typeof location.newBlockId === "string"
            ? { newBlockId: location.newBlockId }
            : {}),
          ...(typeof location.beforeBlockId === "string"
            ? { beforeBlockId: location.beforeBlockId }
            : {}),
          ...(typeof location.afterBlockId === "string"
            ? { afterBlockId: location.afterBlockId }
            : {}),
          ...(typeof location.oldHtml === "string"
            ? { oldHtml: location.oldHtml }
            : {}),
          ...(typeof location.newHtml === "string"
            ? { newHtml: location.newHtml }
            : {}),
          runs,
        },
      ];
    },
  );
  if (locations.length !== value.locations.length) return null;
  const places = value.places.flatMap((place): ReadonlyArray<DiffPlace> => {
    if (
      !isReviewWireRecord(place) ||
      typeof place.placeId !== "string" ||
      (place.status !== "changed" &&
        place.status !== "added" &&
        place.status !== "removed") ||
      typeof place.label !== "string" ||
      typeof place.section !== "string" ||
      (place.note !== "reworded" &&
        place.note !== "rewritten" &&
        place.note !== "replaced" &&
        place.note !== "added" &&
        place.note !== "removed") ||
      !Array.isArray(place.locationIndexes)
    ) {
      return [];
    }
    const locationIndexes = place.locationIndexes.filter(
      (index): index is number =>
        typeof index === "number" &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < locations.length,
    );
    if (locationIndexes.length !== place.locationIndexes.length) return [];
    return [
      {
        placeId: place.placeId,
        status: place.status,
        label: place.label,
        section: place.section,
        note: place.note,
        locationIndexes,
      },
    ];
  });
  return { from: value.from, to: value.to, locations, places };
};
