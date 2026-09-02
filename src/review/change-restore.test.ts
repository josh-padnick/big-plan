// Proves that rejecting one change puts back exactly that change's bytes:
// the reviewer's other decisions survive, an undo re-derives the plan the
// rejection had never touched, and a restore that cannot be isolated is
// refused rather than approximated.

import { basename, extname } from "node:path";
import { describe, expect, it } from "vitest";
import { renderDocument } from "../render/render-document.js";
import {
  ChangeRestoreRejected,
  restoreRejectedPlaces,
} from "./change-restore.js";
import { buildSnapshotDiff } from "./snapshot-diff.js";

const FROM = "a".repeat(16);
const TO = "b".repeat(16);
const TITLE = basename("plan.mdx", extname("plan.mdx"));

const placesOf = ({
  baselineSource,
  proposedSource,
}: {
  readonly baselineSource: string;
  readonly proposedSource: string;
}) =>
  buildSnapshotDiff({
    from: FROM,
    to: TO,
    before: renderDocument({
      markdown: baselineSource,
      fallbackTitle: TITLE,
      identity: {},
    }).blocks,
    after: renderDocument({
      markdown: proposedSource,
      fallbackTitle: TITLE,
      identity: {},
    }).blocks,
  }).places;

const placeLabelled = (
  places: ReturnType<typeof placesOf>,
  label: string,
): string => {
  const place = places.find((candidate) => candidate.label.includes(label));
  if (place === undefined) {
    throw new Error(
      `No diff place labelled ${label}; saw ${places
        .map((candidate) => candidate.label)
        .join(", ")}`,
    );
  }
  return place.placeId;
};

const restore = ({
  baselineSource,
  proposedSource,
  placeIds,
}: {
  readonly baselineSource: string;
  readonly proposedSource: string;
  readonly placeIds: ReadonlyArray<string>;
}) =>
  restoreRejectedPlaces({
    baselineSource,
    proposedSource,
    from: FROM,
    to: TO,
    placeIds,
    fallbackTitle: TITLE,
  });

const BASELINE = `# Retry the failed checkout

## The retry queue

Failed checkouts wait in a durable queue.

Each attempt is spaced by an exponential backoff.

## The worker

One worker drains the queue every ten seconds.
`;

// Two independent changes: the queue paragraph is reworded, and the worker
// paragraph is replaced. A reviewer decides them one at a time.
const PROPOSED = `# Retry the failed checkout

## The retry queue

Failed checkouts wait in a durable Postgres queue.

Each attempt is spaced by an exponential backoff.

## The worker

Two workers drain the queue every two seconds.
`;

describe("restoreRejectedPlaces", () => {
  it("returns the proposed revision untouched when nothing is rejected", () => {
    expect(
      restore({
        baselineSource: BASELINE,
        proposedSource: PROPOSED,
        placeIds: [],
      }),
    ).toBe(PROPOSED);
  });

  it("puts one change back to the baseline bytes and leaves the other alone", () => {
    const places = placesOf({
      baselineSource: BASELINE,
      proposedSource: PROPOSED,
    });
    const restored = restore({
      baselineSource: BASELINE,
      proposedSource: PROPOSED,
      placeIds: [placeLabelled(places, "durable")],
    });
    expect(restored).toContain("wait in a durable queue.");
    expect(restored).not.toContain("durable Postgres queue");
    expect(restored).toContain(
      "Two workers drain the queue every two seconds.",
    );
  });

  // The whole point of deriving the source from the rejected set: a reviewer
  // who rejects both changes lands on the thread's baseline exactly, and one
  // who then undoes both lands back on the agent's proposal exactly.
  it("lands on the baseline when every change is rejected", () => {
    const places = placesOf({
      baselineSource: BASELINE,
      proposedSource: PROPOSED,
    });
    expect(
      restore({
        baselineSource: BASELINE,
        proposedSource: PROPOSED,
        placeIds: places.map((place) => place.placeId),
      }),
    ).toBe(BASELINE);
  });

  it("re-derives the same bytes whichever order the rejections arrived in", () => {
    const places = placesOf({
      baselineSource: BASELINE,
      proposedSource: PROPOSED,
    });
    const ids = places.map((place) => place.placeId);
    const forward = restore({
      baselineSource: BASELINE,
      proposedSource: PROPOSED,
      placeIds: ids,
    });
    const backward = restore({
      baselineSource: BASELINE,
      proposedSource: PROPOSED,
      placeIds: [...ids].reverse(),
    });
    expect(backward).toBe(forward);
  });

  // Undo is the same derivation with the place taken out of the set, so a
  // rejection followed by its undo has to leave no trace at all.
  it("undoes a rejection back to the exact proposed bytes", () => {
    const places = placesOf({
      baselineSource: BASELINE,
      proposedSource: PROPOSED,
    });
    const rejected = placeLabelled(places, "durable");
    const others = places
      .map((place) => place.placeId)
      .filter((placeId) => placeId !== rejected);
    expect(
      restore({
        baselineSource: BASELINE,
        proposedSource: PROPOSED,
        placeIds: others,
      }),
    ).toBe(
      restore({
        baselineSource: BASELINE,
        proposedSource: PROPOSED,
        placeIds: others,
      }),
    );
    expect(
      restore({
        baselineSource: BASELINE,
        proposedSource: PROPOSED,
        placeIds: [],
      }),
    ).toBe(PROPOSED);
  });

  it("takes back a paragraph the agent added without disturbing its neighbours", () => {
    const proposed = `# Retry the failed checkout

## The retry queue

Failed checkouts wait in a durable queue.

Every enqueue is idempotent.

Each attempt is spaced by an exponential backoff.

## The worker

One worker drains the queue every ten seconds.
`;
    const places = placesOf({
      baselineSource: BASELINE,
      proposedSource: proposed,
    });
    expect(
      restore({
        baselineSource: BASELINE,
        proposedSource: proposed,
        placeIds: places.map((place) => place.placeId),
      }),
    ).toBe(BASELINE);
  });

  it("puts back a paragraph the agent removed", () => {
    const proposed = `# Retry the failed checkout

## The retry queue

Failed checkouts wait in a durable queue.

## The worker

One worker drains the queue every ten seconds.
`;
    const places = placesOf({
      baselineSource: BASELINE,
      proposedSource: proposed,
    });
    expect(
      restore({
        baselineSource: BASELINE,
        proposedSource: proposed,
        placeIds: places.map((place) => place.placeId),
      }),
    ).toBe(BASELINE);
  });

  // A component is one authored node, so rejecting it puts the whole component
  // back rather than reaching into markup the author never split.
  it("puts a whole component back when its change is rejected", () => {
    const baseline = `# Skill distribution

## The channel

<Callout type="note" title="Delivery">

The repository copy remains canonical.

</Callout>

The installer runs offline.
`;
    const proposed = `# Skill distribution

## The channel

<Callout type="warning" title="Delivery">

The published site copy is canonical instead.

</Callout>

The installer runs offline.
`;
    const places = placesOf({
      baselineSource: baseline,
      proposedSource: proposed,
    });
    expect(
      restore({
        baselineSource: baseline,
        proposedSource: proposed,
        placeIds: places.map((place) => place.placeId),
      }),
    ).toBe(baseline);
  });

  // The two changes sit in different authored nodes, one of them a component,
  // so deciding them apart has to leave the other node byte-identical.
  it("leaves a component alone when a change beside it is rejected", () => {
    const baseline = `# Skill distribution

## The channel

<Callout type="note" title="Delivery">

The repository copy remains canonical.

</Callout>

The installer runs offline.
`;
    const proposed = `# Skill distribution

## The channel

<Callout type="tip" title="Delivery">

The repository copy remains canonical.

</Callout>

The installer needs the network.
`;
    const places = placesOf({
      baselineSource: baseline,
      proposedSource: proposed,
    });
    const restored = restore({
      baselineSource: baseline,
      proposedSource: proposed,
      placeIds: [placeLabelled(places, "installer")],
    });
    expect(restored).toContain('<Callout type="tip" title="Delivery">');
    expect(restored).toContain("The installer runs offline.");
    expect(restored).not.toContain("needs the network");
  });

  it("refuses a place the agent's proposal does not contain", () => {
    expect(() =>
      restore({
        baselineSource: BASELINE,
        proposedSource: PROPOSED,
        placeIds: ["not-a-place"],
      }),
    ).toThrow(ChangeRestoreRejected);
  });

  // Nothing changed at all, so there is no authored source to put back and no
  // honest answer to give: refusing is the only one that does not write bytes
  // on a guess.
  it("refuses when the two revisions hold the same source", () => {
    expect(() =>
      restore({
        baselineSource: BASELINE,
        proposedSource: BASELINE,
        placeIds: ["anything"],
      }),
    ).toThrow(ChangeRestoreRejected);
  });
});
