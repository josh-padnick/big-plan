// Owns the browser-safe projection from agent exchange facts to review
// threads. The browser and coding-agent loop consume this view instead of
// joining requests, responses, outcomes, progress, and comments themselves.

import { deriveAgentStatus, type AgentStatus } from "./agent-status.js";
import { requestIsCanceled, type CancelableRequest } from "./cancel-pending.js";
import type { ReviewComment } from "./comment.js";
import type { ProgressStepCode } from "./progress-code.js";

export type ThreadRequest = CancelableRequest & {
  readonly sourceRevision: string;
  readonly claimedFromRevision?: string;
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
  readonly state: "changed" | "question" | "outside";
  readonly message: string;
  readonly changeTargets?: ReadonlyArray<string>;
};

export type ThreadResponse = {
  readonly requestId: string;
  readonly sourceRevision: string;
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

export type ProjectedThreadExchange<
  Request extends ThreadRequest = ThreadRequest,
  Response extends ThreadResponse = ThreadResponse,
> = {
  readonly request: Request;
  readonly response?: Response;
  readonly outcome?: ThreadOutcome;
  readonly activity: ReadonlyArray<ThreadProgress>;
  readonly status: AgentStatus;
  readonly canceled: boolean;
  readonly baselineRevision: string;
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

export const projectRequestActivity = ({
  request,
  progressEvents,
}: {
  readonly request: ThreadRequest;
  readonly progressEvents: ReadonlyArray<ThreadProgress>;
}): ReadonlyArray<ThreadProgress> =>
  progressEvents.filter((event) => event.requestId === request.requestId);

export const projectRequestStatus = ({
  request,
  response,
  progressEvents,
  presence,
  runtime,
  surface,
  nowMs,
  cancelPendingRequestIds,
}: {
  readonly request: ThreadRequest;
  readonly response: ThreadResponse | undefined;
  readonly progressEvents: ReadonlyArray<ThreadProgress>;
  readonly presence: ThreadPresence;
  readonly runtime: ThreadRuntime;
  readonly surface: ThreadSurface;
  readonly nowMs: number;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
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
  const claimedAtMs =
    request.claimedAt === undefined ? 0 : Date.parse(request.claimedAt);
  const lastSignalAtMs = Math.max(
    0,
    ...activity.map((event) => event.atMs ?? 0),
    Number.isNaN(claimedAtMs) ? 0 : claimedAtMs,
    presence.requestId === request.requestId ? (presence.updatedAtMs ?? 0) : 0,
  );
  return deriveAgentStatus({
    runtime,
    request: response === undefined ? "pending" : "answered",
    agentConnected: presence.connected,
    pickedUp: request.claimedAt !== undefined || activity.length > 0,
    sessionBusy:
      presence.state === "working" && presence.requestId !== request.requestId,
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
  const exchanges = requests
    .filter((request) => requestCommentIds(request).includes(comment.id))
    .map((request): ProjectedThreadExchange<Request, Response> => {
      const response = responses.find(
        (candidate) => candidate.requestId === request.requestId,
      );
      const outcome = response?.outcomes?.find(
        (candidate) => candidate.commentId === comment.id,
      );
      return {
        request,
        ...(response === undefined ? {} : { response }),
        ...(outcome === undefined ? {} : { outcome }),
        activity: projectRequestActivity({ request, progressEvents }),
        status: projectRequestStatus({
          request,
          response,
          progressEvents,
          presence,
          runtime,
          surface: "thread",
          nowMs,
          cancelPendingRequestIds,
        }),
        canceled: requestIsCanceled({
          request,
          pendingRequestIds: cancelPendingRequestIds,
        }),
        baselineRevision: request.claimedFromRevision ?? request.sourceRevision,
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
    latestExchange.response === undefined &&
    !latestExchange.canceled;
  const group: ThreadGroup =
    latestExchange?.outcome?.state === "question"
      ? "needs-input"
      : latestExchange?.outcome !== undefined
        ? "ready"
        : latestStatus?.stage === "working" || latestStatus?.stage === "stalled"
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
      exchanges.every((exchange) => exchange.response === undefined),
    canDeleteCanceled:
      (latestExchange?.canceled ?? false) &&
      exchanges.every(
        (exchange) =>
          exchange.response === undefined &&
          exchange.request.claimedAt === undefined,
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
