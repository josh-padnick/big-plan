// Owns the status vocabulary for review-wide agent activity and one request.
// It derives presentation facts from runtime input. It stores no state and
// does not depend on the browser or Node.

import type { ProgressStepCode } from "./progress-code.js";

export const AGENT_STALL_MS = 90_000;

export type AgentActivityRequest = {
  readonly requestId: string;
  readonly kind: "feedback" | "reply" | "chat";
  readonly createdAt: string;
  readonly claimedAt?: string;
  readonly baselineSnapshot?: string;
  readonly targetLabel?: string;
};

export type AgentActivityProgress = {
  readonly requestId?: string;
  readonly atMs?: number;
  readonly stepCode: ProgressStepCode;
  readonly step: string;
  readonly state: string;
  readonly detail?: string;
};

type ActivityRequestFacts = {
  readonly requestId: string;
  readonly requestKind: AgentActivityRequest["kind"];
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
      readonly state: "disconnected";
      readonly tone: "danger";
      readonly headline: "The agent is disconnected";
      readonly supporting: "Reconnect the coding agent to continue. All comments are safe.";
    }
  | {
      readonly state: "offline";
      readonly tone: "danger";
      readonly headline: "The review server is unreachable";
      readonly supporting: string;
    }
  | {
      readonly state: "idle";
      readonly tone: "neutral";
      readonly headline: "Agent connected";
      readonly supporting: "The agent is connected and waiting for feedback.";
    };

/** Maps current activity to the one exceptional label shown in viewer chrome. */
export const deriveAgentHealthLabel = ({
  activity,
  hasAgentRuntime,
  isReadOnly,
}: {
  readonly activity: CurrentAgentActivity;
  readonly hasAgentRuntime: boolean;
  readonly isReadOnly: boolean;
}): string | null => {
  if (isReadOnly) return "Using read-only session";
  if (!hasAgentRuntime) return null;
  if (activity.state === "offline") return "Review server offline";
  if (activity.state === "disconnected") return "Agent connection lost";
  if (activity.state === "stalled") return "Agent not responding";
  if (activity.state === "errored") return "Agent error";
  return null;
};

const requestHeadline = (request: AgentActivityRequest): string =>
  request.kind === "feedback"
    ? "Responding to a comment"
    : request.kind === "reply"
      ? "Responding in a comment thread"
      : "Answering a plan question";

const requestFacts = (request: AgentActivityRequest): ActivityRequestFacts => ({
  requestId: request.requestId,
  requestKind: request.kind,
  ...(request.targetLabel === undefined
    ? {}
    : { targetLabel: request.targetLabel }),
});

const meaningfulWork = (
  event: AgentActivityProgress,
  requestId: string,
): boolean =>
  event.requestId === requestId &&
  (event.state === "live" || event.state === "waiting") &&
  event.stepCode !== "reply-sent" &&
  event.stepCode !== "chat-sent";

const stalledHint =
  "Check the agent terminal - it may be waiting for your approval, out of usage or rate-limited, or stopped. This updates by itself once the agent resumes.";

/** Derives the single current-work card from immutable runtime facts. */
export const deriveCurrentAgentActivity = ({
  requests,
  responseRequestIds,
  progressEvents,
  agentConnected,
  runtimeOffline,
  now,
  heartbeatAt,
}: {
  readonly requests: ReadonlyArray<AgentActivityRequest>;
  readonly responseRequestIds: ReadonlySet<string>;
  readonly progressEvents: ReadonlyArray<AgentActivityProgress>;
  readonly agentConnected: boolean;
  readonly runtimeOffline: boolean;
  readonly now: number;
  readonly heartbeatAt: number;
}): CurrentAgentActivity => {
  if (runtimeOffline) {
    return {
      state: "offline",
      tone: "danger",
      headline: "The review server is unreachable",
      supporting:
        "Restart `big-plan review`, then open the new URL it prints. All comments are safe.",
    };
  }
  if (!agentConnected) {
    return {
      state: "disconnected",
      tone: "danger",
      headline: "The agent is disconnected",
      supporting: "Reconnect the coding agent to continue. All comments are safe.",
    };
  }

  const request = requests.find(
    (candidate) => !responseRequestIds.has(candidate.requestId),
  );
  if (request === undefined) {
    return {
      state: "idle",
      tone: "neutral",
      headline: "Agent connected",
      supporting: "The agent is connected and waiting for feedback.",
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
    meaningfulWork(event, request.requestId),
  );
  const latest = meaningful.at(-1);
  if (
    request.claimedAt === undefined &&
    request.baselineSnapshot === undefined &&
    latest === undefined
  ) {
    return {
      ...facts,
      state: "waiting",
      tone: "warning",
      headline: "Waiting for agent",
      supporting:
        "Feedback is queued and will start when the agent is available.",
    };
  }

  const observedAt = Math.max(
    0,
    latest?.atMs ?? 0,
    heartbeatAt,
    Date.parse(request.claimedAt ?? request.createdAt) || 0,
  );
  if (now - observedAt > AGENT_STALL_MS) {
    return {
      ...facts,
      state: "stalled",
      tone: "warning",
      headline: "Agent may be stalled",
      supporting: stalledHint,
      updatedAtMs: observedAt,
    };
  }

  return {
    ...facts,
    state: "working",
    tone: "working",
    headline: requestHeadline(request),
    latestStep: latest?.step ?? "Picked up by the agent",
    updatedAtMs: observedAt,
  };
};

export type AgentStatusStage =
  | "idle"
  | "waiting"
  | "blocked"
  | "working"
  | "stalled"
  | "failed"
  | "offline"
  | "answered";

export type AgentStatus = {
  readonly stage: AgentStatusStage;
  readonly label: string;
  readonly headline: string;
  readonly detail: string;
  readonly tone: "neutral" | "positive" | "warning" | "danger";
};

export type AgentStatusInput = {
  readonly runtime: "static" | "online" | "offline";
  readonly request: "none" | "pending" | "answered";
  readonly agentConnected: boolean;
  readonly pickedUp: boolean;
  readonly sessionBusy?: boolean;
  readonly surface?: "thread" | "chat";
  readonly lastAgentSignalAtMs?: number;
  readonly failure?: string;
  readonly nowMs: number;
};

/** Derives status from observable runtime, request, and agent-channel facts. */
export const deriveAgentStatus = (input: AgentStatusInput): AgentStatus => {
  if (input.runtime === "static") {
    return {
      stage: "idle",
      label: "Offline file",
      headline: "Open the local review runtime to contact the agent",
      detail: "Your browser drafts remain safe on this device.",
      tone: "neutral",
    };
  }
  if (input.runtime === "offline") {
    return {
      stage: "offline",
      label: "Runtime offline",
      headline: "The review server is unreachable",
      detail:
        "Restart `big-plan review`, then open the new URL it prints. All comments are safe.",
      tone: "danger",
    };
  }
  if (input.failure !== undefined) {
    return {
      stage: "failed",
      label: "Needs attention",
      headline: "The agent reported a problem",
      detail: input.failure,
      tone: "danger",
    };
  }
  if (input.request === "answered") {
    return {
      stage: "answered",
      label: "Response ready",
      headline: "The agent has answered",
      detail: "Review the response and continue the thread if needed.",
      tone: "positive",
    };
  }
  if (input.request === "none") {
    return {
      stage: "idle",
      label: input.agentConnected ? "Agent connected" : "No agent connected",
      headline: input.agentConnected
        ? "Ready for feedback"
        : "Connect a coding agent when you are ready to send",
      detail: input.agentConnected
        ? "The agent is waiting for a review request."
        : "Draft comments remain local until you send them.",
      tone: input.agentConnected ? "positive" : "neutral",
    };
  }
  if (!input.agentConnected) {
    return {
      stage: "blocked",
      label: "Blocked",
      headline: "Blocked - no agent connected",
      detail:
        "Your comment is saved and sends itself as soon as an agent reconnects. Nothing is lost.",
      tone: "warning",
    };
  }
  if (!input.pickedUp) {
    return {
      stage: "waiting",
      label: "Waiting",
      headline:
        input.sessionBusy === true
          ? "Waiting - the agent is working on another request"
          : "Waiting for an agent",
      detail: "",
      tone: "neutral",
    };
  }
  const quietFor =
    input.lastAgentSignalAtMs === undefined
      ? null
      : Math.max(0, input.nowMs - input.lastAgentSignalAtMs);
  if (quietFor === null || quietFor > AGENT_STALL_MS) {
    return {
      stage: "stalled",
      label: "Working",
      headline:
        quietFor === null
          ? "No progress reported yet"
          : `No progress for ${Math.max(1, Math.round(quietFor / 60_000))}m`,
      detail:
        (input.agentConnected ? "The agent session is still connected. " : "") +
        stalledHint,
      tone: "warning",
    };
  }
  return {
    stage: "working",
    label: "Agent working",
    headline:
      input.surface === "chat"
        ? "Agent is working on your feedback"
        : "Agent is working on this",
    detail: "",
    tone: "positive",
  };
};
