// The route that reports which runtime currently owns this review, so the
// browser can tell a live session from one a newer runtime has replaced - and,
// because this is the only route the page polls that the runtime answers about
// itself, whether that runtime has stopped accepting changes.

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
  const writesStalledMs = context.writeGate.stalledForMs();
  const expiresAtMs = context.activityClock.expiresAtMs();
  return jsonResponse({
    status: 200,
    value: encodeRuntimeSession({
      ...sessionView,
      ...(writesStalledMs === undefined ? {} : { writesStalledMs }),
      // Published for recovery consumers other than the offline banner, which
      // cannot prove that this runtime stopped.
      restartCommand: context.restartCommand,
      idleTimeoutMs: context.activityClock.idleTimeoutMs,
      ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
    }),
  });
};
