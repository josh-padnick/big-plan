// Reports retained review state without owning its persistence or lifecycle.

import { publishedJsonFileNames } from "./store-files.js";
import { progressLogLineCount } from "./progress-log.js";
import type { ReviewStore } from "./store.js";

/** How much persistent state one review session currently retains. */
export type ReviewStoreGrowth = {
  readonly progressLines: number;
  readonly agentRequests: number;
  readonly agentResponses: number;
};

/**
 * Counts persistent review state for long-session diagnostics. The progress
 * log is compacted, while agent exchange files continue to accumulate, so a
 * suspected long-session stall needs the current retained sizes as numbers,
 * not as a hypothesis.
 */
export const reviewStoreGrowth = async ({
  store,
}: {
  readonly store: ReviewStore;
}): Promise<ReviewStoreGrowth> => {
  // Counted through the same cache the read paths use, so asking how much of
  // the log remains does not itself re-read it every minute.
  const progressLines = await progressLogLineCount(store.progressPath);
  const [agentRequests, agentResponses] = await Promise.all([
    publishedJsonFileNames(store.agentRequestDirectory).then(
      (names) => names.length,
    ),
    publishedJsonFileNames(store.agentResponseDirectory).then(
      (names) => names.length,
    ),
  ]);
  return { progressLines, agentRequests, agentResponses };
};
