// Owns the stable semantic codes carried by review progress events. Display
// copy remains free to change without becoming control flow.

export const PROGRESS_STEP_CODES = [
  "feedback-received",
  "queued-comment-deleted",
  "reply-sent",
  "chat-sent",
  "request-canceled",
  "request-picked-up",
  "response-ready",
  "agent-note",
] as const;

export type ProgressStepCode = (typeof PROGRESS_STEP_CODES)[number];

const PROGRESS_STEP_CODE_SET: ReadonlySet<string> = new Set(
  PROGRESS_STEP_CODES,
);

/** Narrows untrusted progress data to the stable semantic vocabulary. */
export const isProgressStepCode = (value: unknown): value is ProgressStepCode =>
  typeof value === "string" && PROGRESS_STEP_CODE_SET.has(value);
