// Owns what a review is waiting for: the enumerable set of inputs it expects,
// which of them the plan's author called critical, and the one arithmetic that
// turns that set into a judgment about whether the plan is ready.
//
// The contract exists because "is this plan ready to approve" was previously
// unanswerable. Two records hold the reviewer's work - decision answers and
// change dispositions - and each answers only its own question. Neither knows
// every input the review expects, so neither can say what is still outstanding,
// and a surface that counted one of them would report readiness while the
// other still held open work.
//
// One input is one obligation the reviewer either has met or has not. Its
// state is derived, never stored: an answer that stopped applying is stale
// rather than answered, and restoring the wording it answered makes it
// answered again, exactly as the answers store's currency predicate decides.
// Nothing here writes, and nothing here remembers.

/** What kind of thing a review is waiting on. */
export type ReviewInputKind = "decision" | "change-set";

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
  /** Stable within one plan: a decision id, or a change-set id. */
  readonly inputId: string;
  readonly kind: ReviewInputKind;
  /** What this input is, in the reviewer's words rather than an id. */
  readonly label: string;
  /**
   * True only where the plan's author said this question must be settled.
   * A change set is never critical: criticality is an authoring judgment about
   * a question, and no author writes a change set. An unreviewed change set is
   * still open work and still counts against readiness; it just does not carry
   * the author's claim that approving without it would be wrong.
   */
  readonly isCritical: boolean;
  readonly state: ReviewInputState;
  /** One line naming what was recorded, or what is still missing. */
  readonly detail: string;
};

/**
 * The whole contract as one response.
 *
 * Both source revisions travel because the contract is derived from two
 * independent records, each with its own monotonic write count. A browser
 * treats a response as newer only when neither revision went backwards, which
 * is the same guard each record already gives its own reader and the only one
 * that holds when two of them are joined.
 */
export type ReviewInputContract = {
  readonly inputs: ReadonlyArray<ReviewInput>;
  readonly answersRevision: number;
  readonly dispositionsRevision: number;
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
  answersRevision: -1,
  dispositionsRevision: -1,
});
