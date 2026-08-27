// Owns the stable semantic codes carried by review progress events. Display
// copy remains free to change without becoming control flow.

export const PROGRESS_STEP_CODES = [
  "feedback-received",
  "queued-comment-deleted",
  "reply-sent",
  "chat-sent",
  "queued-message-revised",
  "queued-message-deleted",
  "request-canceled",
  "plan-approved",
  "approval-acknowledged",
  "approval-revoked",
  "claim-released",
  "agent-disconnect-requested",
  "push-opened",
  "agent-primacy-answered",
  "request-picked-up",
  "request-reclaimed",
  "response-ready",
  "agent-note",
  "agent-disconnected",
] as const;

export type ProgressStepCode = (typeof PROGRESS_STEP_CODES)[number];
export type ProgressState = "waiting" | "live" | "done" | "failed";

const PROGRESS_STEP_OWNERS = {
  "feedback-received": "reviewer",
  "queued-comment-deleted": "reviewer",
  "reply-sent": "reviewer",
  "chat-sent": "reviewer",
  "queued-message-revised": "reviewer",
  "queued-message-deleted": "reviewer",
  "request-canceled": "reviewer",
  "plan-approved": "reviewer",
  "approval-acknowledged": "agent",
  "approval-revoked": "reviewer",
  "claim-released": "reviewer",
  "agent-disconnect-requested": "reviewer",
  "push-opened": "agent",
  // The reviewer decides who speaks for the plan, so the answer is theirs even
  // though what it moves is an agent's role.
  "agent-primacy-answered": "reviewer",
  "request-picked-up": "agent",
  "request-reclaimed": "agent",
  "response-ready": "agent",
  "agent-note": "agent",
  "agent-disconnected": "agent",
} as const satisfies Readonly<Record<ProgressStepCode, "reviewer" | "agent">>;

const PROGRESS_STATES: ReadonlySet<string> = new Set([
  "waiting",
  "live",
  "done",
  "failed",
]);

const PROGRESS_STEP_CODE_SET: ReadonlySet<string> = new Set(
  PROGRESS_STEP_CODES,
);

/** Narrows untrusted progress data to the stable semantic vocabulary. */
export const isProgressStepCode = (value: unknown): value is ProgressStepCode =>
  typeof value === "string" && PROGRESS_STEP_CODE_SET.has(value);

export const progressStepCodeIsAgentOwned = (
  value: ProgressStepCode,
): boolean => PROGRESS_STEP_OWNERS[value] === "agent";

/** Narrows untrusted progress data to its lifecycle state vocabulary. */
export const isProgressState = (value: unknown): value is ProgressState =>
  typeof value === "string" && PROGRESS_STATES.has(value);
