// Owns the status vocabulary for review-wide agent activity and one request.
// It derives presentation facts from runtime input. It stores no state and
// does not depend on the browser or Node.

import { progressStepCodeIsAgentOwned } from "./progress-code.js";
import type { ProgressStepCode } from "./progress-code.js";
import {
  claimIsLive,
  claimSignalAtMs,
  type ClaimedRequest,
} from "./agent-claim.js";
import {
  requestIsTerminal,
  type TerminalAgentRequest,
} from "./agent-request-state.js";
import { AGENT_STALL_MS, AGENT_STALL_WINDOW_LABEL } from "./agent-timing.js";
import type { BrowserConnectionEvent } from "./review-wire.js";
import { compactDurationLabel } from "./time-label.js";

// Agents are asked to send a progress note at least once per minute while
// working, and the extra 15 seconds absorbs scheduling and filesystem jitter.
// The window bounds how long silence stays presented as progress; it does not
// decide whether an agent is attached, because no signal renews while a turn
// runs (BIG-147).
export { AGENT_STALL_MS, AGENT_STALL_WINDOW_LABEL } from "./agent-timing.js";

export type AgentActivityRequest = ClaimedRequest &
  TerminalAgentRequest & {
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
  // A queue position is ordinary, not a problem, so it stays out of the
  // warning register the stalled and errored states own.
  | ({
      readonly state: "waiting";
      readonly tone: "neutral";
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
      readonly supporting: string;
    }
  | {
      readonly state: "offline";
      readonly tone: "danger";
      readonly headline: "Agent is unreachable";
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
  if (activity.state === "offline" || activity.state === "disconnected") {
    return "Agent disconnected";
  }
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
  progressStepCodeIsAgentOwned(event.stepCode);

const stalledHint =
  "Check the agent terminal - it may be waiting for your approval, out of usage or rate-limited, or stopped. This updates by itself once the agent resumes.";

/** Expires a browser-held presence snapshot at the same lease as the store. */
export const agentPresenceIsFresh = ({
  connected,
  heartbeatAt,
  now,
}: {
  readonly connected: boolean;
  readonly heartbeatAt: number;
  readonly now: number;
}): boolean =>
  connected &&
  Number.isFinite(heartbeatAt) &&
  Number.isFinite(now) &&
  heartbeatAt > 0 &&
  Math.max(0, now - heartbeatAt) <= AGENT_STALL_MS;

/**
 * True while some agent is holding work here that it has neither answered nor
 * had canceled, whether or not its lease still holds. This is the one place
 * that fact is defined; the runtime and the page both ask it so they cannot
 * disagree about whether silence means anyone is home.
 */
export const agentHoldsClaimedWork = (
  requests: ReadonlyArray<ClaimedRequest & TerminalAgentRequest>,
): boolean =>
  requests.some(
    (request) => !requestIsTerminal(request) && request.claimedBy !== undefined,
  );

/**
 * Reconciles persisted connection events with the current presence lease.
 *
 * `holdsOpenRequest` is the same fact the runtime consults before it writes a
 * disconnect edge. An agent that is holding work has no process left to renew
 * the plan-wide heartbeat, so without it the page would draw a disconnection
 * the runtime deliberately declined to record (BIG-147).
 */
export const projectAgentConnectionState = ({
  presenceConnected,
  heartbeatAt,
  now,
  events,
  holdsOpenRequest = false,
}: {
  readonly presenceConnected: boolean;
  readonly heartbeatAt: number;
  readonly now: number;
  readonly events: ReadonlyArray<BrowserConnectionEvent>;
  readonly holdsOpenRequest?: boolean;
}): {
  readonly connected: boolean;
  readonly events: ReadonlyArray<BrowserConnectionEvent>;
} => {
  const connected =
    holdsOpenRequest ||
    agentPresenceIsFresh({
      connected: presenceConnected,
      heartbeatAt,
      now,
    });
  let latest: { readonly connected: boolean; readonly atMs: number } | null =
    null;
  for (const event of events) {
    const atMs = Date.parse(event.at);
    if (Number.isFinite(atMs) && (latest === null || atMs >= latest.atMs)) {
      latest = { connected: event.connected, atMs };
    }
  }
  if (latest === null || latest.connected === connected) {
    return { connected, events };
  }

  const leaseExpired =
    Number.isFinite(heartbeatAt) &&
    Number.isFinite(now) &&
    heartbeatAt > 0 &&
    now - heartbeatAt > AGENT_STALL_MS;
  const observedAtMs = connected
    ? heartbeatAt
    : leaseExpired
      ? heartbeatAt + AGENT_STALL_MS + 1
      : now;
  const projectedAtMs = Math.max(observedAtMs, latest.atMs + 1);
  const projectedAt = new Date(projectedAtMs);
  if (Number.isNaN(projectedAt.getTime())) return { connected, events };

  return {
    connected,
    events: [
      ...events,
      {
        eventId: `presence-${connected ? "connected" : "disconnected"}-${projectedAtMs}`,
        connected,
        at: projectedAt.toISOString(),
        ...(!connected && leaseExpired
          ? { reason: `No agent signal within ${AGENT_STALL_WINDOW_LABEL}` }
          : {}),
      },
    ],
  };
};

/**
 * Reports the silence itself rather than a verdict about the agent. Nothing
 * renews a claim while the turn runs, so a quiet lease is evidence of quiet and
 * of nothing else - and telling the reviewer to reconnect here would invite a
 * second agent to take the plan from the one still working (adr/0002).
 */
const stalledSupporting = ({
  signalAtMs,
  now,
}: {
  readonly signalAtMs: number;
  readonly now: number;
}): string => {
  const quietFor = compactDurationLabel({
    start: signalAtMs,
    end: Math.max(now, signalAtMs),
  });
  return quietFor === null
    ? `The agent picked this up and has not reported progress since. ${stalledHint}`
    : `The agent picked this up and has reported nothing for ${quietFor}. ${stalledHint}`;
};

/** Explains a lost lease without claiming why the external agent stopped. */
const disconnectedSupporting = ({
  heartbeatAt,
  now,
}: {
  readonly heartbeatAt: number;
  readonly now: number;
}): string => {
  const quietFor = compactDurationLabel({
    start: heartbeatAt,
    end: Math.max(now, heartbeatAt),
  });
  return quietFor === null
    ? "Reconnect the coding agent to continue. All comments are safe."
    : `No agent signal for ${quietFor} (disconnect threshold: ${AGENT_STALL_WINDOW_LABEL}); the session may have ended or gone idle. Reconnect to continue. All comments are safe.`;
};

/** True once an agent has picked a request up, lease still live or not. */
const requestWasClaimed = (request: AgentActivityRequest): boolean =>
  request.claimedBy !== undefined && claimSignalAtMs(request) !== undefined;

/** Selects the first live, nonterminal claim. */
export const selectActiveAgentRequest = <Request extends AgentActivityRequest>({
  requests,
  cancelPendingRequestIds,
  now,
}: {
  readonly requests: ReadonlyArray<Request>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
  readonly now: number;
}): Request | undefined =>
  requests.find(
    (request) =>
      !requestIsTerminal(request) &&
      !cancelPendingRequestIds.has(request.requestId) &&
      claimIsLive({ request, nowMs: now }),
  );

/**
 * Selects the work an agent is holding, preferring a renewed lease over one
 * that has lapsed. A lapsed lease says nothing about the holder: `agent next`
 * hands the work over and its process exits, so between two progress notes no
 * Big Plan process is running on that agent's behalf and there is no signal to
 * renew (BIG-147).
 */
export const selectClaimedAgentRequest = <
  Request extends AgentActivityRequest,
>({
  requests,
  cancelPendingRequestIds,
  now,
}: {
  readonly requests: ReadonlyArray<Request>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
  readonly now: number;
}): Request | undefined =>
  selectActiveAgentRequest({ requests, cancelPendingRequestIds, now }) ??
  requests.find(
    (request) =>
      !requestIsTerminal(request) &&
      !cancelPendingRequestIds.has(request.requestId) &&
      requestWasClaimed(request),
  );

/** Selects live work before falling back to the oldest queued request. */
export const selectPendingAgentRequest = <
  Request extends AgentActivityRequest,
>({
  requests,
  cancelPendingRequestIds,
  now,
}: {
  readonly requests: ReadonlyArray<Request>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
  readonly now: number;
}): Request | undefined =>
  selectActiveAgentRequest({ requests, cancelPendingRequestIds, now }) ??
  requests.find(
    (request) =>
      !requestIsTerminal(request) &&
      !cancelPendingRequestIds.has(request.requestId),
  );

/** Derives the single current-work card from immutable runtime facts. */
export const deriveCurrentAgentActivity = ({
  requests,
  cancelPendingRequestIds,
  progressEvents,
  agentConnected,
  runtimeOffline,
  now,
  heartbeatAt,
}: {
  readonly requests: ReadonlyArray<AgentActivityRequest>;
  readonly cancelPendingRequestIds: ReadonlySet<string>;
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
      headline: "Agent is unreachable",
      supporting:
        "Restart `big-plan review`, then open the new URL it prints. All comments are safe.",
    };
  }
  // Work that has been picked up is judged by its own narration, and never
  // falls through to the presence question below. The two ask different things
  // - "is anyone attached" against "has this turn reported lately" - and the
  // plan-wide heartbeat can only answer the first, because the agent's own
  // process is gone for the length of the turn (BIG-147).
  const claimed = selectClaimedAgentRequest({
    requests,
    cancelPendingRequestIds,
    now,
  });
  if (claimed !== undefined) {
    const facts = requestFacts(claimed);
    const failed = progressEvents
      .filter(
        (event) =>
          event.requestId === claimed.requestId && event.state === "failed",
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
    const signalAtMs = claimSignalAtMs(claimed) ?? 0;
    if (!claimIsLive({ request: claimed, nowMs: now })) {
      return {
        ...facts,
        state: "stalled",
        tone: "warning",
        headline: "Agent may be stalled",
        supporting: stalledSupporting({ signalAtMs, now }),
        updatedAtMs: signalAtMs,
      };
    }
    const meaningful = progressEvents.filter((event) =>
      meaningfulWork(event, claimed.requestId),
    );
    const latest = meaningful.at(-1);
    return {
      ...facts,
      state: "working",
      tone: "working",
      headline: requestHeadline(claimed),
      latestStep: latest?.step ?? "Picked up by the agent",
      updatedAtMs: signalAtMs,
    };
  }

  const request = selectPendingAgentRequest({
    requests,
    cancelPendingRequestIds,
    now,
  });
  if (!agentPresenceIsFresh({ connected: agentConnected, heartbeatAt, now })) {
    return {
      state: "disconnected",
      tone: "danger",
      headline: "The agent is disconnected",
      supporting: disconnectedSupporting({ heartbeatAt, now }),
    };
  }
  if (request === undefined) {
    return {
      state: "idle",
      tone: "neutral",
      headline: "Agent connected",
      supporting: "The agent is connected and waiting for feedback.",
    };
  }
  return {
    ...requestFacts(request),
    state: "waiting",
    tone: "neutral",
    headline: "Waiting for agent",
    supporting:
      "Feedback is queued and will start when the agent is available.",
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
  /** How many unanswered messages the agent delivers before this one. */
  readonly queuedAhead?: number;
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
      headline: "Agent is unreachable",
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
  if (!input.pickedUp) {
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
    // The position is what makes a queue feel like a queue rather than a
    // stall, so it replaces the bare label whenever anything is ahead.
    const ahead = input.queuedAhead ?? 0;
    return {
      stage: "waiting",
      label: ahead > 0 ? `Queued, ${ahead} ahead` : "Waiting",
      headline: "Waiting for an agent",
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
      // No claim about the session itself: the same silence that reaches this
      // branch is the only evidence there is either way (BIG-147).
      detail: stalledHint,
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
