// Owns the browser's answer to "did a push just land?".
//
// A push is the one exchange the reviewer did not start, so the review island
// has to notice it rather than be told. The arrival fact is deliberately the
// response id: a push response id newly present in a poll payload is the only
// signal that is both terminal (the commit already happened) and durable
// (nothing about it is browser-held, so a reload simply re-seeds). The article
// swap stays driven purely by the snapshot changing, which is why the settle
// targets below are looked up by result snapshot rather than by arrival: the
// swap knows which revision it is showing, not which poll noticed it.
//
// Seeding is the subtle half. A reader who opens a plan with pushes already in
// it has not just been pushed to, so the first payload marks every push
// response seen and reports no arrivals. Only a payload that adds one does.

import type { AgentModelIdentity } from "./agent-model.js";
import type { AgentRequest, AgentResponse } from "./review-wire.js";

/** One push that landed while the reader was reading. */
export type PushArrival = {
  readonly requestId: string;
  /** The thread the push opened or replied into, for the entry's controls. */
  readonly threadId: string;
  readonly resultSnapshot: string;
  /** When the commit landed, for the entry's freshness label. */
  readonly arrivedAt: string;
  /** Every block the revision changed, in the order the agent listed them. */
  readonly changeTargets: ReadonlyArray<string>;
  /** What the agent declared about itself when it claimed the push. */
  readonly model?: AgentModelIdentity;
  /**
   * The writer that claimed the push, which is the only thing that tells two
   * connectors running the same model apart. The roster names them by it, and
   * an entry that could not would be naming a model rather than an agent.
   */
  readonly claimedBy?: string;
};

export type PushArrivalScan = {
  readonly arrivals: ReadonlyArray<PushArrival>;
  /** The seed for the next scan; pass it back verbatim. */
  readonly seenPushResponseIds: ReadonlySet<string>;
};

const pushResponses = (
  responses: ReadonlyArray<AgentResponse>,
): ReadonlyArray<AgentResponse> =>
  responses.filter((response) => response.kind === "push");

/**
 * Every block a response reported changed, deduplicated but kept in the order
 * the agent listed them, because that order is presentation order and the
 * settle reads as one sweep down the page rather than a scatter.
 */
const changedBlocks = (response: AgentResponse): ReadonlyArray<string> => [
  ...new Set(response.outcomes.flatMap((outcome) => outcome.changeTargets)),
];

/**
 * Reports the pushes this payload added, and the seed for the next scan.
 *
 * A null seed means the island has not scanned yet: every push already in the
 * payload is recorded as seen and nothing is reported, so opening a plan is
 * never mistaken for being pushed to.
 */
export const scanPushArrivals = ({
  requests,
  responses,
  seenPushResponseIds,
}: {
  readonly requests: ReadonlyArray<AgentRequest>;
  readonly responses: ReadonlyArray<AgentResponse>;
  readonly seenPushResponseIds: ReadonlySet<string> | null;
}): PushArrivalScan => {
  const landed = pushResponses(responses);
  if (seenPushResponseIds === null) {
    return {
      arrivals: [],
      seenPushResponseIds: new Set(
        landed.map((response) => response.requestId),
      ),
    };
  }
  const seen = new Set(seenPushResponseIds);
  const arrivals: Array<PushArrival> = [];
  for (const response of landed) {
    if (seen.has(response.requestId)) continue;
    const request = requests.find(
      (candidate) =>
        candidate.requestId === response.requestId && candidate.kind === "push",
    );
    // A response whose request has not reached this reader yet cannot be
    // attributed to a thread, so it stays unseen and arrives on the payload
    // that carries both. Recording it seen here would lose the arrival.
    if (request?.threadId === undefined) continue;
    seen.add(response.requestId);
    arrivals.push({
      requestId: response.requestId,
      threadId: request.threadId,
      resultSnapshot: response.resultSnapshot,
      arrivedAt: response.createdAt,
      changeTargets: changedBlocks(response),
      ...(request.claimedModel === undefined
        ? {}
        : { model: request.claimedModel }),
      ...(request.claimedBy === undefined
        ? {}
        : { claimedBy: request.claimedBy }),
    });
  }
  return { arrivals, seenPushResponseIds: seen };
};

/**
 * The one arrival a payload announces, out of everything it carried.
 *
 * A single poll can deliver more than one push: a backgrounded tab is
 * throttled to roughly a minute, and an agent can commit twice inside that.
 * The reader is still told about one arrival, because two "just now" entries
 * cannot both be the thing that just happened, and the newest push is the one
 * whose pusher and thread the entry names.
 *
 * What it must not do is describe only that push's blocks. The article the
 * reader is now looking at differs from the one they remember everywhere any
 * of these pushes touched, so the blocks it reports are all of theirs: in the
 * order they landed, newest last, and without repeats. Anything narrower
 * would count and highlight less than actually moved, and leave the rest for
 * the reader to find on their own.
 */
export const announcedArrival = (
  arrivals: ReadonlyArray<PushArrival>,
): PushArrival | undefined => {
  const latest = arrivals.at(-1);
  if (latest === undefined) return undefined;
  return {
    ...latest,
    changeTargets: [
      ...new Set(arrivals.flatMap((arrival) => arrival.changeTargets)),
    ],
  };
};

/**
 * The blocks a settle belongs on for the revision a swap is about to show.
 *
 * Asked of the arrival this reader was actually told about rather than of
 * whichever push happens to share the snapshot, because a snapshot does not
 * identify a transition. A revert restores the request's baseline, and that
 * baseline is the previous push's result: answering by snapshot alone would
 * wash the blocks that earlier push changed and leave the blocks that just
 * moved unmarked, with nothing anywhere reporting the mismatch. An empty
 * answer means this swap was not a push landing, which is how it is told apart
 * from every other reason plan DOM is replaced.
 */
export const pushSettleTargets = ({
  arrival,
  resultSnapshot,
}: {
  readonly arrival: PushArrival | null;
  readonly resultSnapshot: string;
}): ReadonlyArray<string> =>
  arrival === null ||
  resultSnapshot === "" ||
  arrival.resultSnapshot !== resultSnapshot
    ? []
    : arrival.changeTargets;
