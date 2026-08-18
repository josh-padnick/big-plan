// The routes that own what the reviewer has done with the changes an agent
// made: the record read back on load, and the one mutation that changes it.
//
// Acceptance is a review fact rather than a browser preference, which is the
// whole reason these routes exist. Two surfaces show one change set's standing
// at the same moment, a reload must not reopen work the reviewer closed, and
// approval will later count what is still open. A record only one browser
// holds cannot answer any of those.

import { jsonResponse, payloadOf, refusal } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteRequest,
  ReviewRouteResponse,
} from "./review-route-context.js";
import {
  applyChangeDispositionMutation,
  ChangeDispositionsRejected,
  validateChangeDispositionMutation,
} from "./change-dispositions-store.js";
import type { StoredChangeDispositions } from "./change-dispositions-store.js";
import { encodeChangeDispositions } from "./shared/review-wire.js";

// The stored record carries a version this build understands; the wire carries
// the facts a browser counts. Answering with the record itself would publish a
// storage detail no reader has any use for.
const dispositionState = (
  dispositions: StoredChangeDispositions,
): ReviewRouteResponse =>
  jsonResponse({
    status: 200,
    value: encodeChangeDispositions({
      accepted: dispositions.accepted,
      revision: dispositions.revision,
    }),
  });

/** Reads the recorded dispositions with the revision that produced them. */
export const readChangeDispositionState = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> =>
  dispositionState(await context.changeDispositions.read());

/**
 * Applies one mutation to the disposition record. Registration in the route
 * table gives this the write gate and the session-authority check, so the whole
 * read-modify-write stays atomic against another browser's mutation and only a
 * session that still holds authority reaches it.
 */
export const disposeOfChanges = async (
  context: ReviewRouteContext,
  request: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { changeDispositions } = context;
  try {
    const mutation = validateChangeDispositionMutation({
      value: payloadOf(request.body),
      now: new Date().toISOString(),
    });
    const dispositions = applyChangeDispositionMutation({
      dispositions: await changeDispositions.read(),
      mutation,
    });
    await changeDispositions.write(dispositions);
    return dispositionState(dispositions);
  } catch (error: unknown) {
    if (error instanceof ChangeDispositionsRejected) {
      return refusal({ status: 400, reason: error.message });
    }
    throw error;
  }
};
