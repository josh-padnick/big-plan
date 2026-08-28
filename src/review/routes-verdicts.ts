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
  applyChangeVerdictMutation,
  ChangeVerdictsRejected,
  validateChangeVerdictMutation,
} from "./change-verdicts-store.js";
import type { StoredChangeVerdicts } from "./change-verdicts-store.js";
import { encodeChangeVerdicts } from "./shared/review-wire.js";

// The stored record carries a version this build understands; the wire carries
// the facts a browser counts. Answering with the record itself would publish a
// storage detail no reader has any use for.
const verdictState = (verdicts: StoredChangeVerdicts): ReviewRouteResponse =>
  jsonResponse({
    status: 200,
    value: encodeChangeVerdicts({
      accepted: verdicts.accepted,
      revision: verdicts.revision,
    }),
  });

/** Reads the recorded verdicts with the revision that produced them. */
export const readChangeVerdictState = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> =>
  verdictState(await context.changeVerdicts.read());

/**
 * Applies one mutation to the verdict record. Registration in the route
 * table gives this the write gate and the session-authority check, so the whole
 * read-modify-write stays atomic against another browser's mutation and only a
 * session that still holds authority reaches it.
 */
export const recordChangeVerdicts = async (
  context: ReviewRouteContext,
  request: ReviewRouteRequest,
): Promise<ReviewRouteResponse> => {
  const { changeVerdicts } = context;
  try {
    const mutation = validateChangeVerdictMutation({
      value: payloadOf(request.body),
      now: new Date().toISOString(),
    });
    const verdicts = await changeVerdicts.update((current) =>
      applyChangeVerdictMutation({ verdicts: current, mutation }),
    );
    return verdictState(verdicts);
  } catch (error: unknown) {
    if (error instanceof ChangeVerdictsRejected) {
      return refusal({ status: 400, reason: error.message });
    }
    throw error;
  }
};
