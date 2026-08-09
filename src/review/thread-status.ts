// Owns the single observable status vocabulary for a live review exchange.
// Callers provide facts from the runtime and agent channels; this module does
// not infer work from reviewer actions or from the mere existence of a request.

export const AGENT_QUIET_MS = 90_000;

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
  if (!input.pickedUp) {
    return input.agentConnected
      ? {
          stage: "waiting",
          label: "Waiting",
          headline:
            input.sessionBusy === true
              ? "Waiting - the agent is working on another request"
              : "Waiting for an agent",
          detail: "",
          tone: "neutral",
        }
      : {
          stage: "blocked",
          label: "Blocked",
          headline: "Blocked - no agent connected",
          detail:
            "Your comment is saved and sends itself as soon as an agent reconnects. Nothing is lost.",
          tone: "warning",
        };
  }
  const quietFor =
    input.lastAgentSignalAtMs === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, input.nowMs - input.lastAgentSignalAtMs);
  if (quietFor > AGENT_QUIET_MS) {
    return {
      stage: "stalled",
      label: "Working",
      headline: `No progress for ${Math.max(1, Math.round(quietFor / 60_000))}m`,
      detail:
        (input.agentConnected ? "The agent session is still connected. " : "") +
        "Check the agent terminal - it may be waiting for your approval, out of usage or rate-limited, or stopped. This thread updates by itself once the agent resumes.",
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
