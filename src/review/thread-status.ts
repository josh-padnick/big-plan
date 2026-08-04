// Owns the single lifecycle status shown for a review thread. Keeping this
// decision pure prevents badges, waiting copy, and severity from drifting
// between anchored comments, the tray, and plan-wide chat.

export type ThreadStatusStage =
  | "staged"
  | "sending"
  | "sent"
  | "working"
  | "stalled"
  | "errored"
  | "offline"
  | "outcome"
  | "resolved";

export type ThreadStatus = {
  readonly stage: ThreadStatusStage;
  readonly tone: "neutral" | "working" | "warning" | "danger";
  readonly badge: string;
  readonly headline?: string;
  readonly hint?: string;
  readonly showsSpinner: boolean;
  readonly showsSetup: boolean;
};

type ThreadStatusInput = {
  readonly phase: "staged" | "sending" | "pending" | "outcome" | "resolved";
  readonly surface: "thread" | "chat";
  readonly runtimeOffline?: boolean;
  readonly pickedUp?: boolean;
  readonly quietForMs?: number;
  readonly failedStep?: string;
  readonly failedDetail?: string;
};

const stalledHint =
  "Check the agent terminal - it may be waiting for your approval, out of usage or rate-limited, or stopped. This thread updates by itself once the agent resumes.";

const queuedHint =
  "Your comment is queued in this plan's review session and stays queued until an agent connects. Keep reviewing.";

/** Resolves one thread to exactly one user-facing lifecycle state. */
export const deriveThreadStatus = ({
  phase,
  surface,
  runtimeOffline = false,
  pickedUp = false,
  quietForMs = 0,
  failedStep,
  failedDetail,
}: ThreadStatusInput): ThreadStatus => {
  if (phase === "staged") {
    return {
      stage: "staged",
      tone: "neutral",
      badge: "Staged",
      showsSpinner: false,
      showsSetup: false,
    };
  }
  if (phase === "sending") {
    return {
      stage: "sending",
      tone: "working",
      badge: "Sending",
      showsSpinner: true,
      showsSetup: false,
    };
  }
  if (phase === "outcome" || phase === "resolved") {
    return {
      stage: phase,
      tone: "neutral",
      badge: "",
      showsSpinner: false,
      showsSetup: false,
    };
  }
  if (runtimeOffline) {
    return {
      stage: "offline",
      tone: "danger",
      badge: "Working",
      headline: "The review server is unreachable",
      hint: "Restart `big-plan review`, then reload this page. Your comments are saved locally.",
      showsSpinner: false,
      showsSetup: false,
    };
  }
  if (failedStep !== undefined) {
    const detail =
      failedDetail === undefined || failedDetail === ""
        ? failedStep
        : `${failedStep} - ${failedDetail}`;
    return {
      stage: "errored",
      tone: "danger",
      badge: "Working",
      headline: "The agent reported a problem",
      hint: `${detail}. Reply again or restart \`big-plan agent\`.`,
      showsSpinner: false,
      showsSetup: false,
    };
  }
  if (!pickedUp) {
    return {
      stage: "sent",
      tone: "neutral",
      badge: "Sent",
      headline: "Waiting for an agent",
      hint: queuedHint,
      showsSpinner: false,
      showsSetup: true,
    };
  }
  if (quietForMs > 90_000) {
    return {
      stage: "stalled",
      tone: "warning",
      badge: "Working",
      headline:
        "No progress for " + Math.max(1, Math.round(quietForMs / 60_000)) + "m",
      hint: stalledHint,
      showsSpinner: false,
      showsSetup: false,
    };
  }
  return {
    stage: "working",
    tone: "working",
    badge: "Working",
    headline:
      surface === "chat"
        ? "Agent is working on your feedback"
        : "Agent is working on this",
    showsSpinner: true,
    showsSetup: false,
  };
};
