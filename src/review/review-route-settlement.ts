// Owns the HTTP response for interrupted plan-mutation settlement failures
// shared by reviewer-state and agent-exchange routes.

import { AgentExchangeRejected } from "./agent-exchange.js";
import type { ReviewRouteResponse } from "./review-route-context.js";
import { refusal } from "./review-route-context.js";
import { StagedPlanMutationRejected } from "./staged-plan-mutation.js";

export const settlementRefusal = (error: unknown): ReviewRouteResponse => {
  if (!(error instanceof AgentExchangeRejected)) throw error;
  return refusal({
    status:
      error instanceof StagedPlanMutationRejected &&
      error.code === "unavailable"
        ? 503
        : 409,
    reason: error.message,
  });
};
