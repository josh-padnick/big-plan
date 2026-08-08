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
      headline: "The local review runtime cannot be reached",
      detail: "Drafts are safe. Restart `big-plan review <plan.mdx>`.",
      tone: "danger",
    };
  }
  if (input.failure !== undefined) {
    return {
      stage: "failed",
      label: "Needs attention",
      headline: "The coding agent reported a failure",
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
          label: "Waiting for agent",
          headline: "Feedback is queued",
          detail: "The connected agent has not picked up this request yet.",
          tone: "neutral",
        }
      : {
          stage: "blocked",
          label: "Agent disconnected",
          headline: "Feedback is waiting for a coding agent",
          detail:
            "Drafts are safe. Start the agent command shown below to continue.",
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
      label: "Agent quiet",
      headline: "The agent has not reported progress recently",
      detail: "The request is still open. Check the coding-agent session.",
      tone: "warning",
    };
  }
  return {
    stage: "working",
    label: "Agent working",
    headline: "The coding agent is working on this request",
    detail: "Progress below comes directly from the agent session.",
    tone: "positive",
  };
};
