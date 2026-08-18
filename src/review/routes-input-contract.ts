// The route that answers what this review is still waiting for.
//
// It is a read over the two records the reviewer's work goes into, joined
// against the plan the runtime just compiled. Nothing is stored, because
// nothing here is a decision: which inputs exist is the plan's answer, which
// are met is the records' answer, and holding a third copy of the join is what
// would let a surface report readiness the records disagree with.

import { jsonResponse } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteResponse,
} from "./review-route-context.js";
import { reviewInputs } from "./input-contract.js";
import { encodeReviewInputContract } from "./shared/review-wire.js";

/** Reads the review's input contract with the revisions it was derived from. */
export const readReviewInputContract = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const { decisionAnswers, changeDispositions, planChangeSets } = context;
  const [inventory, inputs, dispositions, changeSets] = await Promise.all([
    decisionAnswers.inventory(),
    decisionAnswers.read(),
    changeDispositions.read(),
    planChangeSets.list(),
  ]);
  return jsonResponse({
    status: 200,
    value: encodeReviewInputContract({
      inputs: reviewInputs({ inventory, inputs, changeSets, dispositions }),
      answersRevision: inputs.revision,
      dispositionsRevision: dispositions.revision,
    }),
  });
};
