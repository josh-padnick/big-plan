// Owns the one replace-in-place projection of the serialized coding-agent
// queue. It derives presentation facts from existing exchange, progress, and
// connection facts; it persists nothing and knows nothing about the DOM.

import type { AgentExchangeSnapshot, AgentRequest } from "./agent-exchange.js";
import type { ProgressEvent } from "./store.js";

export const AGENT_ACTIVITY_STALL_MS = 90_000;

type ActivityRequestFacts = {
  readonly requestId: string;
  readonly requestKind: AgentRequest["kind"];
  readonly targetLabel?: string;
};

export type CurrentAgentActivity =
  | ({
      readonly state: "working";
      readonly tone: "working";
      readonly headline: string;
      readonly latestStep: string;
      readonly updatedAtMs: number;
    } & ActivityRequestFacts)
  | ({
      readonly state: "waiting";
      readonly tone: "warning";
      readonly headline: "Waiting for agent";
      readonly supporting: "Feedback is queued and will start when the agent is available.";
    } & ActivityRequestFacts)
  | ({
      readonly state: "stalled";
      readonly tone: "warning";
      readonly headline: "Agent may be stalled";
      readonly supporting: string;
      readonly updatedAtMs: number;
    } & ActivityRequestFacts)
  | ({
      readonly state: "errored";
      readonly tone: "danger";
      readonly headline: "The agent reported a problem";
      readonly supporting: string;
    } & ActivityRequestFacts)
  | {
      readonly state: "offline";
      readonly tone: "danger";
      readonly headline: "The review server is unreachable";
      readonly supporting: string;
    }
  | {
      readonly state: "idle";
      readonly tone: "neutral";
      readonly headline: "No agent work in progress";
      readonly supporting: string;
    };

export type AgentActivityInput = {
  readonly snapshot: AgentExchangeSnapshot;
  readonly progressEvents: ReadonlyArray<ProgressEvent>;
  readonly agentConnected: boolean;
  readonly runtimeOffline: boolean;
  readonly now: number;
  readonly heartbeatAt: number;
  readonly requestSeenAt?: number;
};

/** Returns the same oldest unanswered, uncancelled request used by the CLI. */
export const nextPendingActivityRequest = (
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

const requestHeadline = (request: AgentRequest): string =>
  request.kind === "feedback"
    ? "Responding to a comment"
    : request.kind === "reply"
      ? "Responding in a comment thread"
      : "Answering a plan question";

const requestTargetLabel = (request: AgentRequest): string | undefined => {
  if (request.kind !== "feedback") return undefined;
  const target = request.comments[0]?.target;
  if (target === undefined || target.type === "document") return "Whole plan";
  return target.section ?? target.label;
};

const isMeaningfulWorkEvent = ({
  event,
  requestId,
}: {
  readonly event: ProgressEvent;
  readonly requestId: string;
}): boolean =>
  event.requestId === requestId &&
  (event.state === "live" || event.state === "waiting") &&
  !/^(reply sent to agent|plan question sent to agent)$/i.test(event.step) &&
  !/feedback package received/i.test(event.step);

const timestamp = (event: ProgressEvent): number => {
  const parsed = Date.parse(event.at ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
};

const requestFacts = (request: AgentRequest): ActivityRequestFacts => ({
  requestId: request.requestId,
  requestKind: request.kind,
  ...(requestTargetLabel(request) === undefined
    ? {}
    : { targetLabel: requestTargetLabel(request) }),
});

const stalledHint =
  "Check the agent terminal - it may be waiting for your approval, out of usage or rate-limited, or stopped. This updates by itself once the agent resumes.";

/** Derives the single current-work card from immutable runtime facts. */
export const deriveCurrentAgentActivity = ({
  snapshot,
  progressEvents,
  agentConnected,
  runtimeOffline,
  now,
  heartbeatAt,
  requestSeenAt,
}: AgentActivityInput): CurrentAgentActivity => {
  if (runtimeOffline) {
    return {
      state: "offline",
      tone: "danger",
      headline: "The review server is unreachable",
      supporting:
        "Restart `big-plan review`, then open the new URL it prints. All comments are safe.",
    };
  }

  const request = nextPendingActivityRequest(snapshot);
  if (request === undefined) {
    return {
      state: "idle",
      tone: "neutral",
      headline: "No agent work in progress",
      supporting: agentConnected
        ? "The agent is connected and waiting for feedback."
        : "Connect an agent to respond to feedback.",
    };
  }

  const facts = requestFacts(request);
  const failed = progressEvents
    .filter(
      (event) =>
        event.requestId === request.requestId && event.state === "failed",
    )
    .at(-1);
  if (failed !== undefined) {
    return {
      ...facts,
      state: "errored",
      tone: "danger",
      headline: "The agent reported a problem",
      supporting:
        failed.step +
        (failed.detail === undefined ? "" : ` - ${failed.detail}`),
    };
  }

  const meaningful = progressEvents.filter((event) =>
    isMeaningfulWorkEvent({ event, requestId: request.requestId }),
  );
  const latest = meaningful.at(-1);
  const pickedUp =
    request.claimedFromRevision !== undefined || latest !== undefined;
  if (!pickedUp) {
    return {
      ...facts,
      state: "waiting",
      tone: "warning",
      headline: "Waiting for agent",
      supporting:
        "Feedback is queued and will start when the agent is available.",
    };
  }

  const lastWorkAt = latest === undefined ? 0 : timestamp(latest);
  const observedAt =
    requestSeenAt ?? Math.max(0, Date.parse(request.createdAt) || 0);
  const lastSignalAt = Math.max(lastWorkAt, heartbeatAt, observedAt);
  if (now - lastSignalAt > AGENT_ACTIVITY_STALL_MS) {
    return {
      ...facts,
      state: "stalled",
      tone: "warning",
      headline: "Agent may be stalled",
      supporting: stalledHint,
      updatedAtMs: lastSignalAt,
    };
  }

  return {
    ...facts,
    state: "working",
    tone: "working",
    headline: requestHeadline(request),
    latestStep: latest?.step ?? "Picked up by the agent",
    updatedAtMs: lastSignalAt,
  };
};
