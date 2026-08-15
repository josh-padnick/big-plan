// Owns which decoded runtime session response the review page may apply. A
// later-arriving older response must never replace newer lifetime facts: a
// stale deadline or missing latestReviewUrl can make the page announce
// something untrue.

import type { RuntimeSession } from "../shared/review-wire.js";

export type RuntimeSessionOrderDecision =
  | { readonly kind: "apply"; readonly session: RuntimeSession }
  | { readonly kind: "drop" };

export type RuntimeSessionOrder = {
  readonly issueRequest: () => number;
  readonly decide: (input: {
    readonly sequence: number;
    readonly session: RuntimeSession;
  }) => RuntimeSessionOrderDecision;
};

/** Creates one ordering owner for a review controller instance. */
export const createRuntimeSessionOrder = (): RuntimeSessionOrder => {
  let nextSequence = 0;
  let highestAcceptedSequence = 0;
  return {
    issueRequest: () => ++nextSequence,
    decide: ({ sequence, session }) => {
      if (sequence <= highestAcceptedSequence) return { kind: "drop" };
      highestAcceptedSequence = sequence;
      return { kind: "apply", session };
    },
  };
};
