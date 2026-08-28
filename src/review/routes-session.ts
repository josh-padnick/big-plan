// The route that reports which runtime currently owns this review, so the
// browser can tell a live session from one a newer runtime has replaced - and,
// because this is the only route the page polls that the runtime answers about
// itself, whether that runtime has stopped accepting changes.

import { readFile } from "node:fs/promises";
import { jsonResponse } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteResponse,
} from "./review-route-context.js";
import { reviewSessionView } from "./session-authority.js";
import { deriveSnapshotDigest } from "./agent-exchange.js";
import { approvalSummary } from "./shared/approval.js";
import { encodeRuntimeSession } from "./shared/review-wire.js";
import { readReviewModeForSession } from "./review-mode-store.js";

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
  const source = await readFile(context.resolvedPlanPath, "utf8");
  const approval = approvalSummary({
    record: await context.approvals.read(),
    currentSnapshot: deriveSnapshotDigest(source),
  });
  const reviewMode = await readReviewModeForSession({
    store: context.store,
    sessionId: context.sessionId,
  });
  return jsonResponse({
    status: 200,
    value: encodeRuntimeSession({
      ...sessionView,
      ...(writesStalledMs === undefined ? {} : { writesStalledMs }),
      // The runtime owns this command because only it knows how it was
      // launched; a browser reconstructing shell syntax guesses wrong for an
      // npx or checkout install. No banner renders it today: recovery must
      // stay non-destructive, and starting a runtime seizes custody from one
      // that may still be live. It is published for surfaces that can first
      // establish the old runtime is gone.
      restartCommand: context.restartCommand,
      idleTimeoutMs: context.activityClock.idleTimeoutMs,
      ...(expiresAtMs === undefined ? {} : { expiresAtMs }),
      ...(approval === undefined ? {} : { approval }),
      ...reviewMode,
    }),
  });
};
