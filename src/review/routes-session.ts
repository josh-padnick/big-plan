// The route that reports which runtime currently owns this review, so the
// browser can tell a live session from one a newer runtime has replaced.

import { jsonResponse } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteResponse,
} from "./review-route-context.js";
import { reviewSessionView } from "./session-authority.js";
import { encodeRuntimeSession } from "./shared/review-wire.js";

export const readRuntimeSession = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const sessionView = await reviewSessionView({
    store: context.store,
    sessionId: context.sessionId,
    planId: context.planId,
    plan: context.resolvedPlanPath,
  });
  return jsonResponse({
    status: 200,
    value: encodeRuntimeSession(sessionView),
  });
};
