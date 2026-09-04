// Proves the reviewer keeps their progress when the thread they are reviewing
// commits another round, and is told which of it stopped applying.
//
// Reported as C9: a set accepted 2/2 under one round's bounds came back 0/3
// under the next round's, from the same stored acceptances. A place id is
// minted under the bounds it was read at, so every place is renamed when the
// set advances; the verdicts stay where they were and nothing reads them
// again.

import { describe, expect, it } from "vitest";
import { carriedVerdicts, spansBehind } from "./change-carry-forward.js";
import type { CommittedPlanRevision } from "./change-set-commit.js";
import { buildSnapshotDiff } from "./snapshot-diff.js";
import type { SnapshotDiff } from "./shared/review-wire.js";
import {
  changeSetStanding,
  changeVerdictKey,
  decidedContentDigests,
  type ChangeVerdict,
} from "./shared/change-verdict.js";

const S0 = "a".repeat(16);
const S1 = "b".repeat(16);
const S2 = "c".repeat(16);
const SET = "cafe";
const OTHER = "beef";
const NOW = "2026-09-02T12:00:00.000Z";

// Two sections, so this thread's own two changes are two review stops. The
// point here is a set that advances, not one that overlaps another.
const ALPHA = "section/one/paragraph-1";
const BRAVO = "section/two/paragraph-1";

const block = ({
  id,
  text,
}: {
  readonly id: string;
  readonly text: string;
}) => ({
  id,
  kind: "paragraph",
  label: text,
  section: id.startsWith("section/one") ? "One" : "Two",
  text,
  isComponentRoot: false,
});

const diffOf = ({
  from,
  to,
  before,
  after,
}: {
  readonly from: string;
  readonly to: string;
  readonly before: ReadonlyArray<{ id: string; text: string }>;
  readonly after: ReadonlyArray<{ id: string; text: string }>;
}): SnapshotDiff =>
  buildSnapshotDiff({
    from,
    to,
    before: before.map(block),
    after: after.map(block),
    // Both blocks belong to the one thread under review, so grouping keeps
    // them apart for the same reason the reader's diff does.
    ownership: new Map([
      [ALPHA, SET],
      [BRAVO, SET],
    ]),
  });

const ALPHA_BEFORE = { id: ALPHA, text: "Alpha as first written." };
const BRAVO_BEFORE = { id: BRAVO, text: "Bravo as first written." };
const ALPHA_AFTER = { id: ALPHA, text: "Alpha after round one." };

const baseline = [ALPHA_BEFORE, BRAVO_BEFORE];
const roundOne = [ALPHA_AFTER, { id: BRAVO, text: "Bravo after round one." }];
// Round two leaves Alpha exactly where round one left it and rewrites Bravo.
const roundTwo = [ALPHA_AFTER, { id: BRAVO, text: "Bravo after round two." }];

const verdict = ({
  placeId,
  contentDigest,
}: {
  readonly placeId: string;
  readonly contentDigest: string;
}): ChangeVerdict => ({
  changeSetId: SET,
  from: S0,
  to: S1,
  placeId,
  verdict: "accepted",
  decidedAt: NOW,
  actor: "reviewer",
  contentDigest,
});

const revision = ({
  requestId,
  changeSetIds,
  baseSnapshot,
  resultSnapshot,
  committedAt,
}: {
  readonly requestId: string;
  readonly changeSetIds: ReadonlyArray<string>;
  readonly baseSnapshot: string;
  readonly resultSnapshot: string;
  readonly committedAt: string;
}): CommittedPlanRevision => ({
  requestId,
  changeSetIds,
  baseSnapshot,
  resultSnapshot,
  provenance: "feedback",
  committedAt,
});

const revisions = [
  revision({
    requestId: "1".repeat(16),
    changeSetIds: [SET],
    baseSnapshot: S0,
    resultSnapshot: S1,
    committedAt: "2026-09-02T11:00:00.000Z",
  }),
  revision({
    requestId: "2".repeat(16),
    changeSetIds: [SET],
    baseSnapshot: S1,
    resultSnapshot: S2,
    committedAt: "2026-09-02T11:30:00.000Z",
  }),
];

describe("carrying verdicts onto an advanced change set", () => {
  const previous = diffOf({
    from: S0,
    to: S1,
    before: baseline,
    after: roundOne,
  });
  const next = diffOf({ from: S0, to: S2, before: baseline, after: roundTwo });
  const decided = previous.places.map((place) =>
    verdict({ placeId: place.placeId, contentDigest: place.contentDigest }),
  );

  it("renames every place when the set advances, which is the defect", () => {
    expect(previous.places).toHaveLength(2);
    expect(next.places).toHaveLength(2);
    expect(next.places.map((place) => place.placeId)).not.toEqual(
      previous.places.map((place) => place.placeId),
    );
    // Read at the new bounds, the reviewer's two acceptances count for nothing.
    const accepted = new Set(decided.map((entry) => changeVerdictKey(entry)));
    expect(
      changeSetStanding({
        changeSetId: SET,
        from: S0,
        to: S2,
        places: next.places,
        accepted,
        rejected: new Set(),
      }),
    ).toMatchObject({ accepted: 0, open: 2, isAccepted: false });
  });

  it("moves each verdict onto the place speaking for the same block", () => {
    const carried = carriedVerdicts({ previous, next, decided });
    expect(carried).toHaveLength(2);
    expect(carried.map((entry) => entry.to)).toEqual([S2, S2]);
    expect(carried.map((entry) => entry.placeId).sort()).toEqual(
      next.places.map((place) => place.placeId).sort(),
    );
    // The reviewer's own act survives the move: who decided it and when are
    // theirs, not the carry's.
    expect(carried.every((entry) => entry.decidedAt === NOW)).toBe(true);
    expect(carried.every((entry) => entry.actor === "reviewer")).toBe(true);
  });

  it("carries one decided place onto every place it splits into", () => {
    const split = buildSnapshotDiff({
      from: S0,
      to: S2,
      before: baseline,
      after: roundOne,
      ownership: new Map([
        [ALPHA_BEFORE.id, SET],
        [BRAVO_BEFORE.id, OTHER],
      ]),
    });
    const combined = buildSnapshotDiff({
      from: S0,
      to: S1,
      before: baseline,
      after: roundOne,
    });
    expect(combined.places).toHaveLength(2);
    const first = combined.places[0];
    if (first === undefined) throw new Error("Expected a changed place");
    const onePlace = {
      ...combined,
      places: [
        {
          ...first,
          locationIndexes: [0, 1],
        },
      ],
    };
    const entry = verdict({
      placeId: first.placeId,
      contentDigest: first.contentDigest,
    });

    expect(
      carriedVerdicts({ previous: onePlace, next: split, decided: [entry] }),
    ).toHaveLength(2);
  });

  it("keeps the untouched change accepted and re-opens only what moved", () => {
    const carried = carriedVerdicts({ previous, next, decided });
    const accepted = new Set(carried.map((entry) => changeVerdictKey(entry)));
    const decidedDigests = decidedContentDigests({
      revision: 1,
      decided: carried,
    });
    const standing = changeSetStanding({
      changeSetId: SET,
      from: S0,
      to: S2,
      places: next.places,
      accepted,
      rejected: new Set(),
      decidedDigests,
    });
    // Alpha is untouched by round two and stays accepted; Bravo was rewritten,
    // so it is owed an answer again - and reported as one the reviewer has
    // already seen rather than as work nobody has looked at.
    expect(standing).toMatchObject({
      total: 2,
      accepted: 1,
      open: 1,
      stale: 1,
      isAccepted: false,
    });
  });

  it("drops a verdict whose change the later round removed", () => {
    const removed = diffOf({
      from: S0,
      to: S2,
      before: baseline,
      // Round two put Bravo back and left only Alpha changed.
      after: [ALPHA_AFTER, BRAVO_BEFORE],
    });
    const carried = carriedVerdicts({ previous, next: removed, decided });
    expect(carried).toHaveLength(1);
    expect(
      removed.places.some((place) => place.placeId === carried[0]?.placeId),
    ).toBe(true);
  });
});

describe("which spans a review has moved past", () => {
  const rowAt = (to: string, changeSetId = SET): ChangeVerdict => ({
    changeSetId,
    from: S0,
    to,
    placeId: "p1",
    verdict: "accepted",
    decidedAt: NOW,
  });

  it("names a set whose verdicts sit at a round it has left behind", () => {
    expect(
      spansBehind({
        revisions,
        verdicts: { version: 1, revision: 1, decided: [rowAt(S1)] },
      }),
    ).toEqual([{ changeSetId: SET, from: S0, staleTo: S1, currentTo: S2 }]);
  });

  it("names nothing when the verdicts already sit at the current span", () => {
    expect(
      spansBehind({
        revisions,
        verdicts: { version: 1, revision: 1, decided: [rowAt(S2)] },
      }),
    ).toEqual([]);
  });

  // A verdict recorded against bounds this change set never published belongs
  // to some other surface - a comment's premise-to-current comparison, say -
  // and re-addressing it would move a decision onto work that never proposed
  // it, which is the same class of mistake as sharing one acceptance between
  // two threads.
  it("leaves alone a verdict at bounds the set never published", () => {
    const foreign: ChangeVerdict = {
      ...rowAt("d".repeat(16)),
    };
    expect(
      spansBehind({
        revisions,
        verdicts: { version: 1, revision: 1, decided: [foreign] },
      }),
    ).toEqual([]);
  });

  it("leaves alone a verdict owned by a set the log does not hold", () => {
    expect(
      spansBehind({
        revisions,
        verdicts: { version: 1, revision: 1, decided: [rowAt(S1, OTHER)] },
      }),
    ).toEqual([]);
  });
});
