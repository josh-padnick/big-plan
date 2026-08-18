// The reader for the review's answers record: how one response from the
// answers store becomes what this page shows, and who is told that it did.
//
// It has a home of its own because two surfaces read the same record and only
// one of them writes to it. The decision cards hold the answers; the Inputs
// panel holds a contract the runtime derives from those same answers. A card
// that applied a response without saying so would leave the panel describing
// an older review than the card two inches away, and nothing would throw - the
// two would simply disagree until something else happened to refetch.
//
// Every response carries the whole current record and the revision that
// produced it, so applying one is the only way this page learns what is
// stored, and a strictly older revision lost a race with a write already
// applied and is dropped without comment.

import { decodeReviewState, type ReviewState } from "../shared/review-wire.js";
import { announceAppliedReviewRecord } from "./review-runtime-client.browser.js";

/** The last answers revision this page applied. A React ref satisfies it. */
export type AppliedAnswersRevision = { current: number };

/**
 * Applies one answers-store response, and announces the ones it applied.
 *
 * Returns whether the response was applied, so a caller that has its own work
 * to do on a fresh record can tell one from a response it has already seen.
 */
export const applyAnswersRecord = ({
  value,
  applied,
  show,
}: {
  readonly value: unknown;
  readonly applied: AppliedAnswersRevision;
  readonly show: (state: ReviewState) => void;
}): boolean => {
  const state = decodeReviewState(value);
  if (state.revision < applied.current) return false;
  applied.current = state.revision;
  show(state);
  announceAppliedReviewRecord();
  return true;
};
