// Owns the one replace-in-place projection of the serialized coding-agent
// queue. It derives presentation facts from exchange, progress, and presence;
// it persists nothing and knows nothing about the browser.

export const AGENT_ACTIVITY_STALL_MS = 90_000;

export type AgentActivityRequest = {
  readonly requestId: string;
  readonly kind: "feedback" | "reply" | "chat";
  readonly createdAt: string;
  readonly claimedAt?: string;
  readonly claimedFromRevision?: string;
  readonly targetLabel?: string;
};

export type AgentActivityProgress = {
  readonly requestId?: string;
  readonly atMs?: number;
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
  | ({
      readonly state: "disconnected";
      readonly tone: "danger";
      readonly headline: "The agent is disconnected";
      readonly supporting: "Reconnect the coding agent to continue. All comments are safe.";
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
  !/^(reply sent to agent|plan question sent to agent)$/i.test(event.step) &&
  !/feedback package received/i.test(event.step);

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

  const request = requests.find(
    (candidate) => !responseRequestIds.has(candidate.requestId),
  );
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

  if (!agentConnected) {
    return {
      ...facts,
      state: "disconnected",
      tone: "danger",
      headline: "The agent is disconnected",
      supporting:
        "Reconnect the coding agent to continue. All comments are safe.",
    };
  }

  const meaningful = progressEvents.filter((event) =>
    meaningfulWork(event, request.requestId),
  );
  const latest = meaningful.at(-1);
  if (
    request.claimedAt === undefined &&
    request.claimedFromRevision === undefined &&
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
  if (now - observedAt > AGENT_ACTIVITY_STALL_MS) {
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
