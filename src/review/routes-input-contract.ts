// The route that answers what this review is still waiting for.
//
// It is a read over the record the reviewer's answers go into, joined against
// the plan the runtime just compiled. Nothing is stored, because nothing here
// is a decision: which inputs exist is the plan's answer, which are met is the
// record's answer, and holding a third copy of the join is what would let a
// surface report readiness the record disagrees with.

import { jsonResponse } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteResponse,
} from "./review-route-context.js";
import { reviewInputs } from "./input-contract.js";
import { encodeReviewInputContract } from "./shared/review-wire.js";

/** Reads the review's input contract with the revision it was derived from. */
export const readReviewInputContract = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const { decisionAnswers } = context;
  const [inventory, inputs] = await Promise.all([
    decisionAnswers.inventory(),
    decisionAnswers.read(),
  ]);
  return jsonResponse({
    status: 200,
    value: encodeReviewInputContract({
      inputs: reviewInputs({ inventory, inputs }),
      revision: inputs.revision,
    }),
  });
};
