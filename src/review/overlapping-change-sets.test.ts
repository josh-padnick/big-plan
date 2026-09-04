// Reproduces the overlap defect BIG-153 exists to close, at the three seams
// that produced it, and proves each one now answers per change set.
//
// The defect, as reported: two comment threads answered by one revision land
// in adjacent blocks of the same section; the diff groups adjacent blocks into
// one review stop; both threads attribute that one stop; and the verdict
// address carried no owner, so the two threads shared a single acceptance
// fact. Accepting the change in thread A marked thread B's change set fully
// accepted, with a spillover count of zero - no disclosure at all.
//
// The three assertions below are the three halves of that failure: grouping
// must keep the two threads' blocks apart, attribution must name the other
// thread rather than count it, and the address must carry the owner even where
// two sets do land on one place.

import { describe, expect, it } from "vitest";
import { changeOwnershipFrom, revisionChainFor } from "./change-ownership.js";
import type { AgentResponse } from "./agent-exchange.js";
import {
  changeSetsFrom,
  type CommittedPlanRevision,
} from "./change-set-commit.js";
import { changeSetsFromCommitted } from "./shared/open-items.js";
import { buildSnapshotDiff } from "./snapshot-diff.js";
import { attributeDiffPlaces } from "./shared/change-attribution.js";
import {
  changeSetStanding,
  changeVerdictKey,
} from "./shared/change-verdict.js";

const S0 = "a".repeat(16);
const S1 = "b".repeat(16);
const S2 = "c".repeat(16);
const S3 = "d".repeat(16);

const THREAD_A = "aaaa";
const THREAD_B = "bbbb";

const ALPHA = "section/section-one/paragraph-1";
const BRAVO = "section/section-one/paragraph-2";
const CHARLIE = "section/section-one/paragraph-3";

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
  section: "Section one",
  text,
  isComponentRoot: false,
});

// Two threads' changes, side by side in one section: exactly the shape the
// report reproduced on main.
const before = [
  block({ id: ALPHA, text: "Alpha paragraph, as first written." }),
  block({ id: BRAVO, text: "Bravo paragraph, as first written." }),
];
const after = [
  block({ id: ALPHA, text: "Alpha paragraph, thread A rewrote this." }),
  block({ id: BRAVO, text: "Bravo paragraph, thread B rewrote this." }),
];

const ownership = new Map([
  [ALPHA, THREAD_A],
  [BRAVO, THREAD_B],
]);

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

const feedbackResponse = ({
  requestId,
  outcomes,
}: {
  readonly requestId: string;
  readonly outcomes: ReadonlyArray<{
    readonly commentId: string;
    readonly changeTargets: ReadonlyArray<string>;
  }>;
}): AgentResponse =>
  ({
    version: 3,
    kind: "feedback",
    requestId,
    sessionId: "1".repeat(16),
    planId: "2".repeat(16),
    claimGeneration: 1,
    resultSnapshot: S1,
    createdAt: "2026-01-01T00:00:00.000Z",
    outcomes: outcomes.map((outcome) => ({
      commentId: outcome.commentId,
      state: "changed",
      message: "Done.",
      changeTargets: outcome.changeTargets,
    })),
  }) as unknown as AgentResponse;

describe("overlapping change sets", () => {
  it("keeps two threads' adjacent changes in two review stops", () => {
    const merged = buildSnapshotDiff({ from: S0, to: S1, before, after });
    // Without ownership this is the defect: one stop, labelled for neither
    // thread, that both of them attribute.
    expect(merged.places).toHaveLength(1);
    expect(merged.places[0]?.label).toBe("Whole section");

    const separated = buildSnapshotDiff({
      from: S0,
      to: S1,
      before,
      after,
      ownership,
    });
    expect(separated.places).toHaveLength(2);
    expect(separated.places.map((place) => place.ownerChangeSetIds)).toEqual([
      [THREAD_A],
      [THREAD_B],
    ]);
  });

  it("does not let an unowned change bridge two owners", () => {
    const bridgedBefore = [
      block({ id: ALPHA, text: "Alpha before." }),
      block({ id: BRAVO, text: "Bravo before." }),
      block({ id: CHARLIE, text: "Charlie before." }),
    ];
    const bridgedAfter = [
      block({ id: ALPHA, text: "Alpha changed by A." }),
      block({ id: BRAVO, text: "Bravo changed without an owner." }),
      block({ id: CHARLIE, text: "Charlie changed by B." }),
    ];
    const separated = buildSnapshotDiff({
      from: S0,
      to: S1,
      before: bridgedBefore,
      after: bridgedAfter,
      ownership: new Map([
        [ALPHA, THREAD_A],
        [CHARLIE, THREAD_B],
      ]),
    });

    expect(separated.places).toHaveLength(2);
    expect(separated.places.map((place) => place.ownerChangeSetIds)).toEqual([
      [THREAD_A],
      [THREAD_B],
    ]);
  });

  it("never marks one thread's change set accepted from the other's gesture", () => {
    const diff = buildSnapshotDiff({
      from: S0,
      to: S1,
      before,
      after,
      ownership,
    });
    const threadA = attributeDiffPlaces({
      diff,
      changeTargets: [ALPHA],
      changeSetId: THREAD_A,
    });
    const threadB = attributeDiffPlaces({
      diff,
      changeTargets: [BRAVO],
      changeSetId: THREAD_B,
    });
    expect(threadA.placeIds).not.toEqual(threadB.placeIds);
    // The other thread's work is named, not counted anonymously.
    expect(threadA.foreign).toEqual([{ changeSetId: THREAD_B, placeCount: 1 }]);
    expect(threadB.foreign).toEqual([{ changeSetId: THREAD_A, placeCount: 1 }]);

    // The reviewer accepts thread A's change, and only thread A's.
    const accepted = new Set(
      threadA.placeIds.map((placeId) =>
        changeVerdictKey({
          changeSetId: THREAD_A,
          from: S0,
          to: S1,
          placeId,
        }),
      ),
    );
    const rejected = new Set<string>();
    expect(
      changeSetStanding({
        changeSetId: THREAD_A,
        from: S0,
        to: S1,
        places: threadA.placeIds.map((placeId) => ({ placeId })),
        accepted,
        rejected,
      }),
    ).toMatchObject({ accepted: 1, open: 0, isAccepted: true });
    expect(
      changeSetStanding({
        changeSetId: THREAD_B,
        from: S0,
        to: S1,
        places: threadB.placeIds.map((placeId) => ({ placeId })),
        accepted,
        rejected,
      }),
    ).toMatchObject({ accepted: 0, open: 1, isAccepted: false });
  });

  // Even where two sets legitimately land on one place - nothing declared the
  // block, so grouping cannot separate them - the owner in the address keeps
  // the two decisions apart.
  it("keeps one shared place's two owners on separate verdict facts", () => {
    const shared = { from: S0, to: S1, placeId: "one-shared-place" };
    expect(changeVerdictKey({ ...shared, changeSetId: THREAD_A })).not.toBe(
      changeVerdictKey({ ...shared, changeSetId: THREAD_B }),
    );
    const accepted = new Set([
      changeVerdictKey({ ...shared, changeSetId: THREAD_A }),
    ]);
    expect(
      changeSetStanding({
        changeSetId: THREAD_B,
        from: S0,
        to: S1,
        places: [{ placeId: shared.placeId }],
        accepted,
        rejected: new Set(),
      }),
    ).toMatchObject({ accepted: 0, open: 1, isAccepted: false });
  });

  // The sequential fold is the case that guarantees overlap: thread A's span
  // grows past thread B's revision the moment B commits between A's rounds.
  it("attributes each block in a folded span to the thread that declared it", () => {
    const revisions = [
      revision({
        requestId: "1".repeat(16),
        changeSetIds: [THREAD_A],
        baseSnapshot: S0,
        resultSnapshot: S1,
        committedAt: "2026-01-01T00:00:00.000Z",
      }),
      revision({
        requestId: "2".repeat(16),
        changeSetIds: [THREAD_B],
        baseSnapshot: S1,
        resultSnapshot: S2,
        committedAt: "2026-01-01T00:01:00.000Z",
      }),
      revision({
        requestId: "3".repeat(16),
        changeSetIds: [THREAD_A],
        baseSnapshot: S2,
        resultSnapshot: S3,
        committedAt: "2026-01-01T00:02:00.000Z",
      }),
    ];
    const responses = [
      feedbackResponse({
        requestId: "1".repeat(16),
        outcomes: [{ commentId: THREAD_A, changeTargets: [ALPHA] }],
      }),
      feedbackResponse({
        requestId: "2".repeat(16),
        outcomes: [{ commentId: THREAD_B, changeTargets: [BRAVO] }],
      }),
      feedbackResponse({
        requestId: "3".repeat(16),
        outcomes: [{ commentId: THREAD_A, changeTargets: [ALPHA] }],
      }),
    ];
    expect(
      revisionChainFor({ revisions, from: S0, to: S3 }).map(
        (entry) => entry.resultSnapshot,
      ),
    ).toEqual([S1, S2, S3]);
    // Thread A's own span carries thread B's edit, and says so.
    expect(
      changeOwnershipFrom({ revisions, responses, from: S0, to: S3 }),
    ).toEqual(
      new Map([
        [ALPHA, THREAD_A],
        [BRAVO, THREAD_B],
      ]),
    );
  });

  it("leaves a block two change sets both declared unowned", () => {
    const revisions = [
      revision({
        requestId: "1".repeat(16),
        changeSetIds: [THREAD_A],
        baseSnapshot: S0,
        resultSnapshot: S1,
        committedAt: "2026-01-01T00:00:00.000Z",
      }),
      revision({
        requestId: "2".repeat(16),
        changeSetIds: [THREAD_B],
        baseSnapshot: S1,
        resultSnapshot: S2,
        committedAt: "2026-01-01T00:01:00.000Z",
      }),
    ];
    const responses = [
      feedbackResponse({
        requestId: "1".repeat(16),
        outcomes: [{ commentId: THREAD_A, changeTargets: [ALPHA, BRAVO] }],
      }),
      feedbackResponse({
        requestId: "2".repeat(16),
        outcomes: [{ commentId: THREAD_B, changeTargets: [BRAVO] }],
      }),
    ];
    expect(
      changeOwnershipFrom({ revisions, responses, from: S0, to: S2 }),
    ).toEqual(new Map([[ALPHA, THREAD_A]]));
  });

  it("answers with no chain when the log cannot reach the baseline", () => {
    const revisions = [
      revision({
        requestId: "1".repeat(16),
        changeSetIds: [THREAD_A],
        baseSnapshot: S1,
        resultSnapshot: S2,
        committedAt: "2026-01-01T00:00:00.000Z",
      }),
    ];
    expect(revisionChainFor({ revisions, from: S0, to: S2 })).toEqual([]);
    expect(
      changeOwnershipFrom({ revisions, responses: [], from: S0, to: S2 }),
    ).toEqual(new Map());
  });
});

// M5: a rejection moves plan bytes, so the log has to say so. Until it did,
// the plan's digest stopped being any recorded revision's result the moment a
// reviewer rejected anything, and every span crossing that point lost the
// ownership partition that keeps two threads' acceptances apart.
describe("a rejection in the committed revision log", () => {
  const REJECTED = "e".repeat(16);
  const proposal = revision({
    requestId: "1".repeat(16),
    changeSetIds: [THREAD_A],
    baseSnapshot: S0,
    resultSnapshot: S1,
    committedAt: "2026-01-01T00:00:00.000Z",
  });
  const rejection: CommittedPlanRevision = {
    requestId: "9".repeat(16),
    changeSetIds: [THREAD_A],
    baseSnapshot: S1,
    resultSnapshot: REJECTED,
    provenance: "reject",
    committedAt: "2026-01-01T00:05:00.000Z",
  };

  it("keeps the chain walkable across the reviewer's own write", () => {
    expect(
      revisionChainFor({
        revisions: [proposal, rejection],
        from: S0,
        to: REJECTED,
      }).map((entry) => entry.resultSnapshot),
    ).toEqual([S1, REJECTED]);
  });

  it("leaves the thread's proposal where the agent left it", () => {
    // A rejection takes some places out; the rest of the proposal is still the
    // reviewer's to decide.
    // The reviewer took out some of the proposal, not all of it, so the rest
    // is still theirs to decide - and their verdicts stay addressed to the
    // span those places were minted under, which is where an undo looks.
    expect(changeSetsFrom([proposal, rejection])).toEqual([
      {
        changeSetId: THREAD_A,
        provenance: "feedback",
        baseSnapshot: S0,
        resultSnapshot: S1,
        committedAt: proposal.committedAt,
      },
    ]);
  });

  it("ends a set whose whole response was taken back out", () => {
    const reverted: CommittedPlanRevision = {
      ...rejection,
      provenance: "revert",
      resultSnapshot: S0,
    };
    // Approval reads the fold, and a set that starts and ends in the same
    // place proposes nothing, so there is no longer anything for approval to
    // auto-accept. That is the defect: a reverted response used to arrive at
    // approval as work still awaiting a verdict.
    expect(changeSetsFrom([proposal, reverted])).toEqual([
      {
        changeSetId: THREAD_A,
        provenance: "feedback",
        baseSnapshot: S0,
        resultSnapshot: S0,
        committedAt: reverted.committedAt,
      },
    ]);
    expect(
      changeSetsFromCommitted({
        committed: changeSetsFrom([proposal, reverted]),
        requests: [],
        placesByRevision: new Map(),
      }),
    ).toEqual([]);
  });

  it("never opens a change set of its own", () => {
    expect(changeSetsFrom([rejection])).toEqual([]);
  });
});
