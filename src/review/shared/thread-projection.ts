// Owns the browser-safe projection from agent exchange facts to review
// threads. The browser and coding-agent loop consume this view instead of
// joining requests, responses, outcomes, progress, and comments themselves.

import {
  deriveAgentStatus,
  selectActiveAgentRequest,
  selectPendingAgentRequest,
  type AgentStatus,
} from "./agent-status.js";
import {
  claimIsLive,
  claimSignalAtMs,
  type ClaimedRequest,
} from "./agent-claim.js";
import {
  requestIsTerminal,
  type TerminalAgentRequest,
} from "./agent-request-state.js";
import { requestIsCanceled, type CancelableRequest } from "./cancel-pending.js";
import type { ReviewComment } from "./comment.js";
import { progressStepCodeIsAgentOwned } from "./progress-code.js";
import type { ProgressStepCode } from "./progress-code.js";
import { requestIsOutstanding } from "./request-lifecycle.js";
import { agentOwnsRequest } from "./request-ownership.js";

export type ThreadRequest = CancelableRequest &
  ClaimedRequest &
  TerminalAgentRequest & {
    readonly premiseSnapshot: string;
    readonly baselineSnapshot?: string;
    readonly claimedAt?: string;
    readonly createdAt: string;
    readonly kind: "feedback" | "reply" | "chat";
    readonly body?: string;
    readonly commentId?: string;
    readonly commentIds?: ReadonlyArray<string>;
    readonly comments?: ReadonlyArray<ReviewComment>;
  };

export type ThreadOutcome = {
  readonly commentId: string;
  readonly state:
    "answered" | "changed" | "warning" | "needs-input" | "declined";
  readonly message: string;
  /** One scannable line, published exactly when the state is "warning". */
  readonly summary?: string;
  readonly changeTargets?: ReadonlyArray<string>;
};

export type ThreadResponse = {
  readonly requestId: string;
  readonly resultSnapshot: string;
  readonly createdAt: string;
  readonly kind: "feedback" | "reply" | "chat";
  readonly outcomes?: ReadonlyArray<ThreadOutcome>;
  readonly message?: string;
};

export type ThreadProgress = {
  readonly requestId?: string;
  readonly atMs?: number;
  readonly seq: number;
  readonly stepCode: ProgressStepCode;
  readonly step: string;
  readonly state: "waiting" | "live" | "done" | "failed";
  readonly detail?: string;
};

export type ThreadPresence = {
  readonly connected: boolean;
  readonly state: "waiting" | "working";
  readonly requestId?: string;
  readonly updatedAtMs?: number;
};

export type ThreadRuntime = "static" | "online" | "offline";
export type ThreadSurface = "thread" | "chat";
export type ThreadGroup = "needs-input" | "ready" | "working" | "queued";
export type RequestDelivery = "Sent" | "Queued";

export type ProjectedThreadExchange<
  Request extends ThreadRequest = ThreadRequest,
  Response extends ThreadResponse = ThreadResponse,
> = {
  readonly request: Request;
  readonly response?: Response;
  readonly outcome?: ThreadOutcome;
  readonly activity: ReadonlyArray<ThreadProgress>;
  readonly status: AgentStatus;
  readonly delivery: RequestDelivery;
  readonly canceled: boolean;
  readonly baselineSnapshot: string;
  /** Whether the reviewer may still edit this waiting message. */
  readonly canReviseMessage: boolean;
  /** Whether the reviewer may still remove this waiting message. */
  readonly canDeleteMessage: boolean;
};

export type CommentThreadProjection<
  Request extends ThreadRequest = ThreadRequest,
  Response extends ThreadResponse = ThreadResponse,
> = {
  readonly comment: ReviewComment;
  readonly exchanges: ReadonlyArray<ProjectedThreadExchange<Request, Response>>;
  readonly latestExchange?: ProjectedThreadExchange<Request, Response>;
  readonly latestChanged?: ProjectedThreadExchange<Request, Response>;
  readonly latestStatus?: AgentStatus;
  readonly latestPending: boolean;
  readonly latestCanceled: boolean;
  readonly canDeleteQueued: boolean;
  readonly canDeleteCanceled: boolean;
  readonly group: ThreadGroup;
};

export const requestCommentIds = (
  request: ThreadRequest,
): ReadonlyArray<string> => {
  if (request.kind === "feedback") {
    return (
      request.commentIds ?? request.comments?.map((comment) => comment.id) ?? []
    );
  }
  return request.kind === "reply" && request.commentId !== undefined
    ? [request.commentId]
    : [];
};

/** Projects delivery from durable terminality or a currently live claim. */
export const projectRequestDelivery = ({
  request,
  nowMs,
}: {
  readonly request: ThreadRequest;
  readonly nowMs: number;
}): RequestDelivery =>
  requestIsTerminal(request) || claimIsLive({ request, nowMs })
    ? "Sent"
    : "Queued";

/** Selects the newest open multi-comment feedback batch. */
export const selectActiveFeedbackBatch = <Request extends ThreadRequest>({
  requests,
  cancelPendingRequestIds,
}: {
  readonly requests: ReadonlyArray<Request>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
}): Request | undefined =>
  [...requests].reverse().find(
    (request) =>
      request.kind === "feedback" &&
      requestCommentIds(request).length > 1 &&
      !requestIsTerminal(request) &&
      !requestIsCanceled({
        request,
        pendingRequestIds: cancelPendingRequestIds,
      }),
  );

export const projectRequestActivity = ({
  request,
  progressEvents,
}: {
  readonly request: ThreadRequest;
  readonly progressEvents: ReadonlyArray<ThreadProgress>;
}): ReadonlyArray<ThreadProgress> =>
  progressEvents.filter(
    (event) =>
      event.requestId === request.requestId &&
      progressStepCodeIsAgentOwned(event.stepCode),
  );

/**
 * Mirrors the mailbox guard on editing a message that still waits. It is a fact
 * about one message, not about its thread: a thread the agent already answered
 * can still hold a follow-up nobody has started.
 */
export const canReviseQueuedMessage = ({
  request,
  response,
  canceled,
}: {
  readonly request: ThreadRequest;
  readonly response: ThreadResponse | undefined;
  readonly canceled: boolean;
}): boolean =>
  request.kind !== "feedback" &&
  !canceled &&
  response === undefined &&
  !agentOwnsRequest(request);

/**
 * Mirrors the mailbox guard on removing a message the agent never started. A
 * canceled message is still removable, which is how a reviewer clears a turn
 * they never meant to send.
 */
export const canDeleteQueuedMessage = ({
  request,
  response,
}: {
  readonly request: ThreadRequest;
  readonly response: ThreadResponse | undefined;
}): boolean =>
  request.kind !== "feedback" &&
  response === undefined &&
  !agentOwnsRequest(request);

/**
 * Counts the unanswered work an agent delivers before one request. Requests
 * arrive in delivery order, so position in the list is the queue position the
 * agent's work loop will honour.
 */
export const queuedRequestsAhead = ({
  request,
  requests,
  responses,
  cancelPendingRequestIds,
}: {
  readonly request: ThreadRequest;
  readonly requests: ReadonlyArray<ThreadRequest>;
  readonly responses: ReadonlyArray<ThreadResponse>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
}): number => {
  const answered = new Set(responses.map((response) => response.requestId));
  const position = requests.findIndex(
    (candidate) => candidate.requestId === request.requestId,
  );
  if (position < 0) return 0;
  return requests.slice(0, position).filter((candidate) =>
    requestIsOutstanding({
      request: candidate,
      answeredRequestIds: answered,
      cancelPendingRequestIds,
    }),
  ).length;
};

/**
 * Derives the one review-wide status from the newest request. It is the second
 * derivation site beside projectRequestStatus, and it lives here so both reach
 * agent activity through projectRequestActivity: a reviewer queue event carries
 * a requestId, and counting it as pickup would report a message the agent has
 * not started as work in progress.
 */
export const projectLatestAgentStatus = ({
  requests,
  responses,
  progressEvents,
  presence,
  runtime,
  agentConnected,
  nowMs,
  cancelPendingRequestIds,
}: {
  readonly requests: ReadonlyArray<ThreadRequest>;
  readonly responses: ReadonlyArray<ThreadResponse>;
  readonly progressEvents: ReadonlyArray<ThreadProgress>;
  readonly presence: ThreadPresence;
  readonly runtime: ThreadRuntime;
  readonly agentConnected: boolean;
  readonly nowMs: number;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
}): AgentStatus => {
  const activeRequest = selectActiveAgentRequest({
    requests,
    cancelPendingRequestIds,
    now: nowMs,
  });
  const request =
    selectPendingAgentRequest({
      requests,
      cancelPendingRequestIds,
      now: nowMs,
    }) ?? requests.at(-1);
  if (request === undefined) {
    return deriveAgentStatus({
      runtime,
      request: "none",
      agentConnected,
      pickedUp: false,
      nowMs,
    });
  }
  return projectRequestStatus({
    request,
    progressEvents,
    presence: { ...presence, connected: agentConnected },
    runtime,
    surface: "chat",
    nowMs,
    cancelPendingRequestIds,
    activeRequestId: activeRequest?.requestId,
    queuedAhead: queuedRequestsAhead({
      request,
      requests,
      responses,
      cancelPendingRequestIds,
    }),
  });
};

export const projectRequestStatus = ({
  request,
  progressEvents,
  presence,
  runtime,
  surface,
  nowMs,
  cancelPendingRequestIds,
  activeRequestId,
  queuedAhead,
}: {
  readonly request: ThreadRequest;
  readonly progressEvents: ReadonlyArray<ThreadProgress>;
  readonly presence: ThreadPresence;
  readonly runtime: ThreadRuntime;
  readonly surface: ThreadSurface;
  readonly nowMs: number;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
  readonly activeRequestId: string | undefined;
  readonly queuedAhead?: number;
}): AgentStatus => {
  if (
    requestIsCanceled({
      request,
      pendingRequestIds: cancelPendingRequestIds,
    })
  ) {
    return {
      stage: "answered",
      label: "Canceled",
      headline: "Request canceled",
      detail: "",
      tone: "neutral",
    };
  }
  const activity = projectRequestActivity({ request, progressEvents });
  const failed = [...activity]
    .reverse()
    .find((event) => event.state === "failed");
  const lastSignalAtMs = claimSignalAtMs(request) ?? 0;
  return deriveAgentStatus({
    runtime,
    request: requestIsTerminal(request) ? "answered" : "pending",
    agentConnected: presence.connected,
    pickedUp: claimIsLive({ request, nowMs }),
    sessionBusy:
      activeRequestId !== undefined && activeRequestId !== request.requestId,
    ...(queuedAhead === undefined ? {} : { queuedAhead }),
    surface,
    ...(lastSignalAtMs > 0 ? { lastAgentSignalAtMs: lastSignalAtMs } : {}),
    ...(failed === undefined ? {} : { failure: failed.detail ?? failed.step }),
    nowMs,
  });
};

export const projectCommentThread = <
  Request extends ThreadRequest,
  Response extends ThreadResponse,
>({
  comment,
  requests,
  responses,
  progressEvents,
  presence,
  runtime,
  nowMs,
  cancelPendingRequestIds,
}: {
  readonly comment: ReviewComment;
  readonly requests: ReadonlyArray<Request>;
  readonly responses: ReadonlyArray<Response>;
  readonly progressEvents: ReadonlyArray<ThreadProgress>;
  readonly presence: ThreadPresence;
  readonly runtime: ThreadRuntime;
  readonly nowMs: number;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
}): CommentThreadProjection<Request, Response> => {
  const activeRequest = selectActiveAgentRequest({
    requests,
    cancelPendingRequestIds,
    now: nowMs,
  });
  const exchanges = requests
    .filter((request) => requestCommentIds(request).includes(comment.id))
    .map((request): ProjectedThreadExchange<Request, Response> => {
      const response = responses.find(
        (candidate) => candidate.requestId === request.requestId,
      );
      const outcome = response?.outcomes?.find(
        (candidate) => candidate.commentId === comment.id,
      );
      const canceled = requestIsCanceled({
        request,
        pendingRequestIds: cancelPendingRequestIds,
      });
      return {
        request,
        ...(response === undefined ? {} : { response }),
        ...(outcome === undefined ? {} : { outcome }),
        activity: projectRequestActivity({ request, progressEvents }),
        status: projectRequestStatus({
          request,
          progressEvents,
          presence,
          runtime,
          surface: "thread",
          nowMs,
          cancelPendingRequestIds,
          activeRequestId: activeRequest?.requestId,
          queuedAhead: queuedRequestsAhead({
            request,
            requests,
            responses,
            cancelPendingRequestIds,
          }),
        }),
        delivery: projectRequestDelivery({ request, nowMs }),
        canceled,
        baselineSnapshot: request.baselineSnapshot ?? request.premiseSnapshot,
        canReviseMessage: canReviseQueuedMessage({
          request,
          response,
          canceled,
        }),
        canDeleteMessage: canDeleteQueuedMessage({ request, response }),
      };
    });
  const latestExchange = exchanges.at(-1);
  const latestChanged = [...exchanges]
    .reverse()
    .find((exchange) => exchange.outcome?.state === "changed");
  const latestStatus =
    latestExchange === undefined || latestExchange.outcome !== undefined
      ? undefined
      : latestExchange.status;
  const latestPending =
    latestExchange !== undefined &&
    !requestIsTerminal(latestExchange.request) &&
    !latestExchange.canceled;
  const group: ThreadGroup =
    latestExchange?.outcome?.state === "needs-input" ||
    latestExchange?.outcome?.state === "warning"
      ? "needs-input"
      : latestExchange?.outcome !== undefined
        ? "ready"
        : latestExchange?.request.answeredAt !== undefined
          ? "ready"
          : latestStatus?.stage === "working" ||
              latestStatus?.stage === "stalled"
            ? "working"
            : "queued";
  return {
    comment,
    exchanges,
    ...(latestExchange === undefined ? {} : { latestExchange }),
    ...(latestChanged === undefined ? {} : { latestChanged }),
    ...(latestStatus === undefined ? {} : { latestStatus }),
    latestPending,
    latestCanceled: latestExchange?.canceled ?? false,
    canDeleteQueued:
      group === "queued" &&
      latestPending &&
      exchanges.every(
        (exchange) =>
          exchange.response === undefined &&
          exchange.request.claimedAt === undefined,
      ),
    canDeleteCanceled:
      (latestExchange?.canceled ?? false) &&
      exchanges.every(
        (exchange) =>
          exchange.response === undefined &&
          !agentOwnsRequest(exchange.request),
      ),
    group,
  };
};

export const projectCommentThreads = <
  Request extends ThreadRequest,
  Response extends ThreadResponse,
>({
  comments,
  ...input
}: Omit<
  Parameters<typeof projectCommentThread<Request, Response>>[0],
  "comment"
> & {
  readonly comments: ReadonlyArray<ReviewComment>;
}): ReadonlyMap<string, CommentThreadProjection<Request, Response>> =>
  new Map(
    comments.map((comment) => [
      comment.id,
      projectCommentThread({ comment, ...input }),
    ]),
  );

export const projectConversationHistory = ({
  request,
  requests,
  responses,
}: {
  readonly request: ThreadRequest;
  readonly requests: ReadonlyArray<ThreadRequest>;
  readonly responses: ReadonlyArray<ThreadResponse>;
}): ReadonlyArray<Readonly<Record<string, unknown>>> => {
  if (request.kind === "feedback") return [];
  const history: Array<Readonly<Record<string, unknown>>> = [];
  for (const candidate of requests) {
    if (candidate.createdAt >= request.createdAt) continue;
    const response = responses.find(
      (entry) => entry.requestId === candidate.requestId,
    );
    if (
      request.kind === "chat" &&
      candidate.kind === "chat" &&
      response?.kind === "chat"
    ) {
      history.push(
        {
          role: "reviewer",
          body: candidate.body,
          createdAt: candidate.createdAt,
        },
        {
          role: "agent",
          body: response.message,
          createdAt: response.createdAt,
        },
      );
    }
    if (
      request.kind === "reply" &&
      candidate.kind === "reply" &&
      candidate.commentId === request.commentId &&
      response?.kind === "reply"
    ) {
      const outcome = response.outcomes?.find(
        (entry) => entry.commentId === request.commentId,
      );
      history.push({
        role: "reviewer",
        body: candidate.body,
        createdAt: candidate.createdAt,
      });
      if (outcome !== undefined) {
        history.push({
          role: "agent",
          body: outcome.message,
          state: outcome.state,
          createdAt: response.createdAt,
        });
      }
    }
    if (
      request.kind === "reply" &&
      candidate.kind === "feedback" &&
      response?.kind === "feedback"
    ) {
      const original = candidate.comments?.find(
        (entry) => entry.id === request.commentId,
      );
      const outcome = response.outcomes?.find(
        (entry) => entry.commentId === request.commentId,
      );
      if (original !== undefined && outcome !== undefined) {
        history.push(
          {
            role: "reviewer",
            body: original.body,
            target: original.target,
            createdAt: original.createdAt,
          },
          {
            role: "agent",
            body: outcome.message,
            state: outcome.state,
            createdAt: response.createdAt,
          },
        );
      }
    }
  }
  return history;
};
