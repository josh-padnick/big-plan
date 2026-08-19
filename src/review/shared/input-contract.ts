// Owns what a review is waiting for: the enumerable set of inputs it expects,
// which of them the plan's author called critical, and the one arithmetic that
// turns that set into a judgment about whether the plan is ready.
//
// The contract exists because "is this plan ready to approve" was previously
// unanswerable. The answers record knows only what was answered, never what
// the plan asked in total, so it cannot say what is still outstanding; a
// surface counting it alone would report readiness for questions nobody had
// reached. The contract covers the plan's decisions for now, and grows to the
// rest of what a review waits on as each of those becomes enumerable.
//
// One input is one obligation the reviewer either has met or has not. Its
// state is derived, never stored: an answer that stopped applying is stale
// rather than answered, and restoring the wording it answered makes it
// answered again, exactly as the answers store's currency predicate decides.
// Nothing here writes, and nothing here remembers.

/**
 * Where one input stands.
 *
 * `stale` is deliberately its own state rather than a flavour of unanswered.
 * The reviewer did the work, and the plan changed underneath it; telling them
 * that is the whole reason the contract enumerates inputs instead of counting
 * them.
 */
export type ReviewInputState = "answered" | "unanswered" | "stale";

/** One thing the review expects from the reviewer before the plan is approved. */
export type ReviewInput = {
  /** Stable within one plan: the decision's own id. */
  readonly inputId: string;
  /** What this input is, in the reviewer's words rather than an id. */
  readonly label: string;
  /**
   * True only where the plan's author said this question must be settled.
   * Criticality is an authoring judgment about a question, so nothing derives
   * it: only the author knows which answers would change what gets built.
   */
  readonly isCritical: boolean;
  readonly state: ReviewInputState;
  /** One line naming what was recorded, or what is still missing. */
  readonly detail: string;
};

/**
 * The whole contract as one response.
 *
 * The source record's revision travels with it because the inputs alone do not
 * say which read is newer. A browser applies a response only when that count
 * has not gone backwards, which is the same guard the record already gives its
 * own reader.
 */
export type ReviewInputContract = {
  readonly inputs: ReadonlyArray<ReviewInput>;
  readonly revision: number;
};

/** How much of the contract is met, and what is still owed. */
export type ReviewInputStanding = {
  readonly total: number;
  readonly answered: number;
  readonly open: number;
  readonly stale: number;
  readonly criticalOpen: number;
  /**
   * True only when the review expects something and every one of those things
   * is answered. An empty contract is not ready: nothing was reviewed, so
   * reporting readiness would report work that never happened.
   */
  readonly isSettled: boolean;
};

/** The one definition of where a review's inputs stand. */
export const reviewInputStanding = (
  inputs: ReadonlyArray<ReviewInput>,
): ReviewInputStanding => {
  const answered = inputs.filter((input) => input.state === "answered").length;
  const stale = inputs.filter((input) => input.state === "stale").length;
  const criticalOpen = inputs.filter(
    (input) => input.isCritical && input.state !== "answered",
  ).length;
  return {
    total: inputs.length,
    answered,
    open: inputs.length - answered,
    stale,
    criticalOpen,
    isSettled: inputs.length > 0 && answered === inputs.length,
  };
};

/** The empty contract a browser holds before the runtime has answered. */
export const emptyReviewInputContract = (): ReviewInputContract => ({
  inputs: [],
  revision: -1,
});
