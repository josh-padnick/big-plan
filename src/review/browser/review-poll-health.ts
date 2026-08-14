// Owns the review controller's consecutive poll-failure state so runtime
// refusal and other poll failures cannot be represented at the same time.

export type ReviewPollHealth =
  | { readonly state: "healthy" }
  | {
      readonly state: "runtime-unavailable";
      readonly consecutiveFailures: number;
    }
  | {
      readonly state: "poll-failed";
      readonly consecutiveFailures: number;
    };

export type ReviewPollResult =
  Exclude<ReviewPollHealth["state"], "healthy"> | "success";

export const INITIAL_REVIEW_POLL_HEALTH = {
  state: "healthy",
} as const satisfies ReviewPollHealth;

/** Advances one poll result while resetting failures from another category. */
export const transitionReviewPollHealth = ({
  health,
  result,
}: {
  readonly health: ReviewPollHealth;
  readonly result: ReviewPollResult;
}): ReviewPollHealth => {
  if (result === "success") return INITIAL_REVIEW_POLL_HEALTH;
  return {
    state: result,
    consecutiveFailures:
      health.state === result ? Math.min(2, health.consecutiveFailures + 1) : 1,
  };
};

export const reviewRuntimeIsDown = (health: ReviewPollHealth): boolean =>
  health.state === "runtime-unavailable" && health.consecutiveFailures >= 2;

export const reviewRuntimeCanWrite = (health: ReviewPollHealth): boolean =>
  !reviewRuntimeIsDown(health);

export const reviewPollIsOffline = (health: ReviewPollHealth): boolean =>
  health.state === "poll-failed" && health.consecutiveFailures >= 2;

export type ReviewAgentProjection =
  | { readonly state: "loading"; readonly nowMs: number }
  | { readonly state: "unobservable"; readonly nowMs: number }
  | { readonly state: "observable"; readonly nowMs: number };

/** Selects the visibility and clock for the agent projection. */
export const agentProjectionForReviewPoll = ({
  health,
  hasObservedAgentSnapshot,
  lastObservableAtMs,
  nowMs,
}: {
  readonly health: ReviewPollHealth;
  readonly hasObservedAgentSnapshot: boolean;
  readonly lastObservableAtMs: number;
  readonly nowMs: number;
}): ReviewAgentProjection => {
  if (!hasObservedAgentSnapshot) {
    return reviewRuntimeIsDown(health)
      ? { state: "unobservable", nowMs: lastObservableAtMs }
      : { state: "loading", nowMs };
  }
  return {
    state: "observable",
    nowMs: health.state === "runtime-unavailable" ? lastObservableAtMs : nowMs,
  };
};
