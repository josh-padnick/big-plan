// The route that reads the reviewer's own state: drafts being written, comments
// already sent, the active draft, and resolved comment ids.

import { jsonResponse } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteResponse,
} from "./review-route-context.js";
import {
  validateActiveDraft,
  validateResolvedCommentIds,
} from "./shared/comment.js";
import { readActiveDraft, readResolvedCommentIds } from "./store.js";
import { encodeReviewSnapshot } from "./shared/review-wire.js";

export const readReviewState = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> => {
  const { store, planRenderer } = context;
  // The document must exist before drafts can be resolved, because the
  // block map is what makes a stored target meaningful.
  await planRenderer.renderPlan();
  return jsonResponse({
    status: 200,
    value: encodeReviewSnapshot({
      drafts: await planRenderer.readStoredComments(store.draftsPath),
      sent: await planRenderer.readStoredComments(store.sentPath),
      activeDraft: await readActiveDraft({
        path: store.activeDraftPath,
        validate: validateActiveDraft,
      }),
      resolvedCommentIds: await readResolvedCommentIds({
        store,
        validate: validateResolvedCommentIds,
      }),
    }),
  });
};
