// The route that answers which change sets the committed revision log
// describes.
//
// Nothing is stored, because a change set is not a record: it is the fold of
// the revisions that crossed the terminal commit, keyed the way
// `change-set-commit.ts` addressed them. Serving the fold rather than the raw
// log is what keeps a thread's baseline and provenance a server fact - a
// browser deriving them from per-response records would re-create the
// per-reply baselines this aggregate exists to retire.

import { jsonResponse } from "./review-route-context.js";
import type {
  ReviewRouteContext,
  ReviewRouteResponse,
} from "./review-route-context.js";
import { readCommittedChangeSets } from "./change-set-commit.js";
import { encodeCommittedChangeSets } from "./shared/review-wire.js";

/** Reads the change sets folded from the committed revision log. */
export const readCommittedChangeSetState = async (
  context: ReviewRouteContext,
): Promise<ReviewRouteResponse> =>
  jsonResponse({
    status: 200,
    value: encodeCommittedChangeSets({
      changeSets: await readCommittedChangeSets({ store: context.store }),
    }),
  });
