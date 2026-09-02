// Owns the runtime mutation that arms or disarms auto-accept. Arming closes
// only the committed transactions in the named pushed thread before it
// publishes the session-scoped mode record.

import { autoAcceptChangeSets } from "./change-set-closure.js";
import { readCommittedRevision } from "./change-set-commit.js";
import { readAgentCommentHistory } from "./agent-exchange.js";
import {
  jsonResponse,
  payloadOf,
  refusal,
  type ReviewRouteContext,
  type ReviewRouteRequest,
  type ReviewRouteResponse,
} from "./review-route-context.js";
import { clearReviewMode, writeArmedReviewMode } from "./review-mode-store.js";
import { withPlanMutationLock } from "./staged-plan-mutation.js";
import type { ReviewStore } from "./store.js";

const THREAD_ID = /^[a-f0-9]{16}$/u;

/** Finds only the immutable change-set transactions owned by one pushed thread. */
const transactionsForThread = async ({
  context,
  store,
  threadId,
}: {
  readonly context: ReviewRouteContext;
  readonly store: ReviewStore;
  readonly threadId: string;
}) => {
  const exchange = await readAgentCommentHistory({
    store,
    sessionId: context.sessionId,
    planId: context.planId,
    commentId: threadId,
  });
  const isPushedThread = exchange.requests.some(
    (request) =>
      request.kind === "push" &&
      request.requestId === threadId &&
      request.threadId === threadId,
  );
  if (!isPushedThread) return undefined;
  const revisions = await Promise.all(
    exchange.requests
      .filter(
        (request) =>
          (request.kind === "push" && request.threadId === threadId) ||
          (request.kind === "reply" && request.commentId === threadId),
      )
      .map((request) =>
        readCommittedRevision({
          store,
          requestId: request.requestId,
        }),
      ),
  );
  return revisions.flatMap((revision) =>
    revision === undefined ||
    (revision.provenance !== "push" && revision.provenance !== "reply")
      ? []
      : [
          {
            from: revision.baseSnapshot,
            to: revision.resultSnapshot,
          },
        ],
  );
};

/** Arms auto-accept from a pushed thread, or returns to review mode. */
export const updateReviewMode = async (
  context: ReviewRouteContext,
  request: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const payload = payloadOf(request.body);
  if (payload.mode === "review") {
    await withPlanMutationLock({
      store: context.store,
      change: (store) => clearReviewMode({ store }),
    });
    return jsonResponse({ status: 200, value: { mode: "review" } });
  }
  if (payload.mode !== "auto-accept") {
    return refusal({
      status: 400,
      reason: '"mode" must be "review" or "auto-accept"',
    });
  }
  if (
    typeof payload.threadId !== "string" ||
    !THREAD_ID.test(payload.threadId)
  ) {
    return refusal({
      status: 400,
      reason: '"threadId" must name a 16 hexadecimal character thread',
    });
  }
  const threadId = payload.threadId;
  return withPlanMutationLock({
    store: context.store,
    change: async (store) => {
      const transactions = await transactionsForThread({
        context,
        store,
        threadId,
      });
      if (transactions === undefined) {
        return refusal({
          status: 404,
          reason: `No pushed thread ${threadId} exists on this plan`,
        });
      }
      const armedAtMs = Date.now();
      await autoAcceptChangeSets({
        store,
        planPath: context.resolvedPlanPath,
        transactions,
        decidedAt: new Date(armedAtMs).toISOString(),
      });
      await writeArmedReviewMode({
        store,
        sessionId: context.sessionId,
        armedAtMs,
      });
      return jsonResponse({
        status: 200,
        value: { mode: "auto-accept", armedAtMs },
      });
    },
  });
};
