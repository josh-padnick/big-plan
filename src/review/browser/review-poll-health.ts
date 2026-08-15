// Owns the review controller's consecutive poll-failure state so runtime
// refusal and other poll failures cannot be represented at the same time.

export type ReviewPollHealth =
  | { readonly state: "healthy" }
  | {
      readonly state: "runtime-unavailable";
      readonly consecutiveFailures: number;
      readonly firstFailureAtMs: number;
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
  nowMs,
}: {
  readonly health: ReviewPollHealth;
  readonly result: ReviewPollResult;
  readonly nowMs: number;
}): ReviewPollHealth => {
  if (result === "success") return INITIAL_REVIEW_POLL_HEALTH;
  if (result === "runtime-unavailable") {
    return {
      state: result,
      consecutiveFailures:
        health.state === result
          ? Math.min(2, health.consecutiveFailures + 1)
          : 1,
      firstFailureAtMs:
        health.state === result ? health.firstFailureAtMs : nowMs,
    };
  }
  return {
    state: result,
    consecutiveFailures:
      health.state === result ? Math.min(2, health.consecutiveFailures + 1) : 1,
  };
};

export const reviewRuntimeIsDown = (health: ReviewPollHealth): boolean =>
  health.state === "runtime-unavailable" && health.consecutiveFailures >= 2;

export const reviewRuntimeDownSinceMs = (
  health: ReviewPollHealth,
): number | undefined =>
  reviewRuntimeIsDown(health) && health.state === "runtime-unavailable"
    ? health.firstFailureAtMs
    : undefined;

export const reviewRuntimeCanWrite = (health: ReviewPollHealth): boolean =>
  !reviewRuntimeIsDown(health);

/**
 * Whether a write sent now could still be accepted. Reachability is not enough:
 * a runtime that has given up on a stalled write keeps answering every read the
 * page polls, so without the runtime's own stall report the page would go on
 * sending changes it has already been told will be refused (BIG-44).
 */
export const reviewRuntimeAcceptsWrites = ({
  health,
  writesStalledMs,
}: {
  readonly health: ReviewPollHealth;
  readonly writesStalledMs: number | undefined;
}): boolean => reviewRuntimeCanWrite(health) && writesStalledMs === undefined;

export const reviewPollIsOffline = (health: ReviewPollHealth): boolean =>
  health.state === "poll-failed" && health.consecutiveFailures >= 2;

export type ReviewAgentProjection =
  | { readonly state: "loading"; readonly nowMs: number }
  | { readonly state: "unobservable"; readonly nowMs: number }
  | { readonly state: "agent-unavailable"; readonly nowMs: number }
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
    if (reviewRuntimeIsDown(health)) {
      return { state: "unobservable", nowMs: lastObservableAtMs };
    }
    return reviewPollIsOffline(health)
      ? { state: "agent-unavailable", nowMs }
      : { state: "loading", nowMs };
  }
  return {
    state: "observable",
    nowMs: health.state === "runtime-unavailable" ? lastObservableAtMs : nowMs,
  };
};
