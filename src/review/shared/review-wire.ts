// Owns the loopback review runtime's browser-safe JSON contract. Server
// encoders and browser decoders meet here so transport changes cannot drift.

import type { ReviewComment } from "./comment.js";
import { isProgressStepCode, type ProgressStepCode } from "./progress-code.js";

export type ReviewSnapshot = {
  readonly drafts: ReadonlyArray<ReviewComment>;
  readonly sent: ReadonlyArray<ReviewComment>;
  readonly activeDraft: string;
  readonly resolvedCommentIds: ReadonlyArray<string>;
};

export type AgentOutcome = {
  readonly commentId: string;
  readonly state: "changed" | "question" | "outside";
  readonly message: string;
  readonly changeTargets: ReadonlyArray<string>;
};

export type AgentRequest = {
  readonly requestId: string;
  readonly sourceRevision: string;
  readonly claimedFromRevision?: string;
  readonly claimedAt?: string;
  readonly canceledAt?: string;
  readonly createdAt: string;
  readonly kind: "feedback" | "reply" | "chat";
  readonly body?: string;
  readonly commentId?: string;
  readonly commentIds: ReadonlyArray<string>;
  readonly targetLabel?: string;
};

export type AgentResponse = {
  readonly requestId: string;
  readonly sourceRevision: string;
  readonly createdAt: string;
  readonly kind: "feedback" | "reply" | "chat";
  readonly outcomes: ReadonlyArray<AgentOutcome>;
  readonly message?: string;
};

export type AgentPresence = {
  readonly connected: boolean;
  readonly state: "waiting" | "working";
  readonly requestId?: string;
  readonly updatedAtMs?: number;
};

export type BrowserConnectionEvent = {
  readonly eventId?: string;
  readonly connected: boolean;
  readonly at: string;
  readonly reason?: string;
};

export type AgentSnapshot = {
  readonly sourceRevision: string;
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

export type DiffLocation = {
  readonly status: "changed" | "added" | "removed";
  readonly label: string;
  readonly section: string;
  readonly runs: ReadonlyArray<DiffRun>;
};

export type RuntimeSession = {
  readonly plan: string;
  readonly authoritative: boolean;
  readonly latestReviewUrl?: string;
};

export type ReviewSnapshotSource = ReviewSnapshot;

export type AgentSnapshotSource = {
  readonly sourceRevision: string;
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
};

export const isReviewWireRecord = (
  value: unknown,
): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Recognizes the bounded comment identity needed by browser persistence. */
export const isReviewCommentValue = (
  value: unknown,
): value is ReviewComment => {
  if (!isReviewWireRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.body === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.target === "object" &&
    value.target !== null
  );
};

/** Encodes the server-owned comment snapshot without losing active draft data. */
export const encodeReviewSnapshot = (
  value: ReviewSnapshotSource,
): ReviewSnapshotSource => value;

/** Decodes comments while dropping malformed local or transport values. */
export const decodeReviewSnapshot = (value: unknown): ReviewSnapshot => {
  if (!isReviewWireRecord(value)) {
    return { drafts: [], sent: [], activeDraft: "", resolvedCommentIds: [] };
  }
  return {
    drafts: Array.isArray(value.drafts)
      ? value.drafts.filter(isReviewCommentValue)
      : [],
    sent: Array.isArray(value.sent)
      ? value.sent.filter(isReviewCommentValue)
      : [],
    activeDraft: typeof value.activeDraft === "string" ? value.activeDraft : "",
    resolvedCommentIds: Array.isArray(value.resolvedCommentIds)
      ? value.resolvedCommentIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
  };
};

export const emptyAgentSnapshot = (): AgentSnapshot => ({
  sourceRevision: "",
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
): AgentSnapshotSource => value;

/** Decodes the agent exchange while preserving only browser-safe facts. */
export const decodeAgentSnapshot = (value: unknown): AgentSnapshot => {
  if (!isReviewWireRecord(value)) return emptyAgentSnapshot();
  const requests = Array.isArray(value.requests)
    ? value.requests.flatMap((request): ReadonlyArray<AgentRequest> => {
        if (
          !isReviewWireRecord(request) ||
          typeof request.requestId !== "string" ||
          typeof request.sourceRevision !== "string" ||
          typeof request.createdAt !== "string" ||
          (request.kind !== "feedback" &&
            request.kind !== "reply" &&
            request.kind !== "chat")
        ) {
          return [];
        }
        return [
          {
            requestId: request.requestId,
            sourceRevision: request.sourceRevision,
            createdAt: request.createdAt,
            kind: request.kind,
            ...(typeof request.claimedFromRevision === "string"
              ? { claimedFromRevision: request.claimedFromRevision }
              : {}),
            ...(typeof request.claimedAt === "string"
              ? { claimedAt: request.claimedAt }
              : {}),
            ...(typeof request.canceledAt === "string"
              ? { canceledAt: request.canceledAt }
              : {}),
            ...(typeof request.body === "string" ? { body: request.body } : {}),
            ...(typeof request.commentId === "string"
              ? { commentId: request.commentId }
              : {}),
            commentIds: Array.isArray(request.comments)
              ? request.comments.flatMap((comment): ReadonlyArray<string> =>
                  isReviewWireRecord(comment) && typeof comment.id === "string"
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
          typeof response.sourceRevision !== "string" ||
          typeof response.createdAt !== "string" ||
          (response.kind !== "feedback" &&
            response.kind !== "reply" &&
            response.kind !== "chat")
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
                  (outcome.state !== "changed" &&
                    outcome.state !== "question" &&
                    outcome.state !== "outside")
                ) {
                  return [];
                }
                return [
                  {
                    commentId: outcome.commentId,
                    state: outcome.state,
                    message: outcome.message,
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
            sourceRevision: response.sourceRevision,
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
        ...(typeof value.presence.updatedAtMs === "number"
          ? { updatedAtMs: value.presence.updatedAtMs }
          : {}),
      }
    : { connected: false, state: "waiting" as const };
  return {
    sourceRevision:
      typeof value.sourceRevision === "string" ? value.sourceRevision : "",
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
    authoritative: value.authoritative !== false,
    ...(typeof value.latestReviewUrl === "string"
      ? { latestReviewUrl: value.latestReviewUrl }
      : {}),
  };
};

/** Encodes a source revision comparison for the browser change digest. */
export const encodeDiffLocations = ({
  from,
  to,
  locations,
}: {
  readonly from: string;
  readonly to: string;
  readonly locations: ReadonlyArray<DiffLocation>;
}): {
  readonly from: string;
  readonly to: string;
  readonly locations: ReadonlyArray<DiffLocation>;
} => ({ from, to, locations });

/** Decodes the bounded revision-diff vocabulary used by the browser. */
export const decodeDiffLocations = (
  value: unknown,
): ReadonlyArray<DiffLocation> => {
  if (!isReviewWireRecord(value) || !Array.isArray(value.locations)) return [];
  return value.locations.flatMap((location): ReadonlyArray<DiffLocation> => {
    if (
      !isReviewWireRecord(location) ||
      (location.status !== "changed" &&
        location.status !== "added" &&
        location.status !== "removed") ||
      typeof location.label !== "string" ||
      typeof location.section !== "string" ||
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
    return [
      {
        status: location.status,
        label: location.label,
        section: location.section,
        runs,
      },
    ];
  });
};
