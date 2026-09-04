// Proves the one selector every surface counts a change set with: what is
// closed, how it was closed, what is still open, and when a set counts as
// accepted or merely settled.

import { describe, expect, it } from "vitest";
import {
  acceptedChangeKeys,
  changeDispositionOf,
  changeVerdictBatches,
  changeVerdictKey,
  changeSetStanding,
  decidedContentDigests,
  rejectedChangeKeys,
  VERDICT_BATCH_LIMIT,
} from "./change-verdict.js";

const FROM = "aaaaaaaaaaaaaaaa";
const TO = "bbbbbbbbbbbbbbbb";
const LATER = "cccccccccccccccc";
const SET = "cafe";
const NOW = "2026-08-18T00:00:00.000Z";

type TestAddress = {
  changeSetId?: string;
  from: string;
  to: string;
  placeId: string;
  verdict?: "accepted" | "rejected";
  contentDigest?: string;
};

const stateOf = (entries: ReadonlyArray<TestAddress>) => ({
  revision: 1,
  decided: entries.map(
    ({ verdict = "accepted" as const, changeSetId = SET, ...address }) => ({
      changeSetId,
      ...address,
      verdict,
      decidedAt: NOW,
    }),
  ),
});

const keys = (entries: ReadonlyArray<TestAddress>) =>
  acceptedChangeKeys(stateOf(entries));

const rejectedKeys = (entries: ReadonlyArray<TestAddress>) =>
  rejectedChangeKeys(
    stateOf(
      entries.map((entry) => ({ ...entry, verdict: "rejected" as const })),
    ),
  );

describe("changeSetStanding", () => {
  it("counts an untouched set as wholly open", () => {
    expect(
      changeSetStanding({
        changeSetId: SET,
        from: FROM,
        to: TO,
        places: ["p1", "p2", "p3"].map((placeId) => ({ placeId })),
        accepted: new Set(),
        rejected: new Set(),
      }),
    ).toEqual({
      total: 3,
      accepted: 0,
      rejected: 0,
      open: 3,
      stale: 0,
      isAccepted: false,
      isSettled: false,
    });
  });

  it("counts a partly accepted set", () => {
    expect(
      changeSetStanding({
        changeSetId: SET,
        from: FROM,
        to: TO,
        places: ["p1", "p2", "p3"].map((placeId) => ({ placeId })),
        accepted: keys([{ from: FROM, to: TO, placeId: "p2" }]),
        rejected: new Set(),
      }),
    ).toEqual({
      total: 3,
      accepted: 1,
      rejected: 0,
      open: 2,
      stale: 0,
      isAccepted: false,
      isSettled: false,
    });
  });

  it("calls a set accepted only when nothing in it is open", () => {
    expect(
      changeSetStanding({
        changeSetId: SET,
        from: FROM,
        to: TO,
        places: ["p1", "p2"].map((placeId) => ({ placeId })),
        accepted: keys([
          { from: FROM, to: TO, placeId: "p1" },
          { from: FROM, to: TO, placeId: "p2" },
        ]),
        rejected: new Set(),
      }),
    ).toEqual({
      total: 2,
      accepted: 2,
      rejected: 0,
      open: 0,
      stale: 0,
      isAccepted: true,
      isSettled: true,
    });
  });

  // A change set with nothing in it was never closed by a reviewer, and
  // reporting it as accepted would credit work that never happened.
  it("does not call an empty set accepted", () => {
    expect(
      changeSetStanding({
        changeSetId: SET,
        from: FROM,
        to: TO,
        places: [].map((placeId) => ({ placeId })),
        accepted: new Set(),
        rejected: new Set(),
      }),
    ).toEqual({
      total: 0,
      accepted: 0,
      rejected: 0,
      open: 0,
      stale: 0,
      isAccepted: false,
      isSettled: false,
    });
  });

  // The address carries both snapshot digests, so acceptance recorded against
  // one revision can never be counted against the revision that replaced it.
  it("does not count an acceptance recorded against another revision", () => {
    expect(
      changeSetStanding({
        changeSetId: SET,
        from: TO,
        to: LATER,
        places: ["p1"].map((placeId) => ({ placeId })),
        accepted: keys([{ from: FROM, to: TO, placeId: "p1" }]),
        rejected: new Set(),
      }),
    ).toEqual({
      total: 1,
      accepted: 0,
      rejected: 0,
      open: 1,
      stale: 0,
      isAccepted: false,
      isSettled: false,
    });
  });

  it("ignores a stored acceptance for a place this set does not hold", () => {
    expect(
      changeSetStanding({
        changeSetId: SET,
        from: FROM,
        to: TO,
        places: ["p1"].map((placeId) => ({ placeId })),
        accepted: keys([
          { from: FROM, to: TO, placeId: "p1" },
          { from: FROM, to: TO, placeId: "elsewhere" },
        ]),
        rejected: new Set(),
      }),
    ).toEqual({
      total: 1,
      accepted: 1,
      rejected: 0,
      open: 0,
      stale: 0,
      isAccepted: true,
      isSettled: true,
    });
  });

  it("counts a rejected place as decided rather than open", () => {
    expect(
      changeSetStanding({
        changeSetId: SET,
        from: FROM,
        to: TO,
        places: ["p1", "p2"].map((placeId) => ({ placeId })),
        accepted: keys([{ from: FROM, to: TO, placeId: "p1" }]),
        rejected: rejectedKeys([{ from: FROM, to: TO, placeId: "p2" }]),
      }),
    ).toEqual({
      total: 2,
      accepted: 1,
      rejected: 1,
      open: 0,
      stale: 0,
      isAccepted: false,
      isSettled: true,
    });
  });

  // A set the reviewer rejected outright is finished with, but calling it
  // accepted would report that the plan kept work it explicitly took out.
  it("settles a wholly rejected set without calling it accepted", () => {
    expect(
      changeSetStanding({
        changeSetId: SET,
        from: FROM,
        to: TO,
        places: ["p1"].map((placeId) => ({ placeId })),
        accepted: new Set(),
        rejected: rejectedKeys([{ from: FROM, to: TO, placeId: "p1" }]),
      }),
    ).toEqual({
      total: 1,
      accepted: 0,
      rejected: 1,
      open: 0,
      stale: 0,
      isAccepted: false,
      isSettled: true,
    });
  });
});

describe("changeDispositionOf", () => {
  const address = { from: FROM, to: TO, placeId: "p1" } as const;
  const key = changeVerdictKey(address);

  it("answers undecided for an address neither set holds", () => {
    expect(
      changeDispositionOf({
        address,
        accepted: new Set(),
        rejected: new Set(),
      }),
    ).toBe("undecided");
  });

  it("answers with the verdict the record holds", () => {
    expect(
      changeDispositionOf({
        address,
        accepted: new Set([key]),
        rejected: new Set(),
      }),
    ).toBe("accepted");
    expect(
      changeDispositionOf({
        address,
        accepted: new Set(),
        rejected: new Set([key]),
      }),
    ).toBe("rejected");
  });
});

describe("verdict key sets", () => {
  it("reads each verdict back under its own question", () => {
    const state = stateOf([
      { from: FROM, to: TO, placeId: "p1" },
      { from: FROM, to: TO, placeId: "p2", verdict: "rejected" },
    ]);
    expect([...acceptedChangeKeys(state)]).toEqual([
      changeVerdictKey({ changeSetId: SET, from: FROM, to: TO, placeId: "p1" }),
    ]);
    expect([...rejectedChangeKeys(state)]).toEqual([
      changeVerdictKey({ changeSetId: SET, from: FROM, to: TO, placeId: "p2" }),
    ]);
  });
});

// A verdict carried onto a later round is a verdict for content the reviewer
// saw. When the round that advanced the set rewrote that content, saying so is
// the whole point: the change is owed an answer again, and the reviewer is
// owed the fact that they have seen it before.
describe("a decision the content moved out from under", () => {
  const DECIDED_OVER = "1".repeat(16);
  const CHANGED_AGAIN = "2".repeat(16);
  const accepted = keys([
    { from: FROM, to: TO, placeId: "p1", contentDigest: DECIDED_OVER },
  ]);
  const decidedDigests = decidedContentDigests(
    stateOf([
      { from: FROM, to: TO, placeId: "p1", contentDigest: DECIDED_OVER },
    ]),
  );
  const dispositionFor = (contentDigest: string | undefined) =>
    changeDispositionOf({
      address: { changeSetId: SET, from: FROM, to: TO, placeId: "p1" },
      accepted,
      rejected: new Set(),
      decidedDigests,
      ...(contentDigest === undefined ? {} : { contentDigest }),
    });

  it("stays accepted while the content it was given for is unchanged", () => {
    expect(dispositionFor(DECIDED_OVER)).toBe("accepted");
  });

  it("reads as stale once that content changes", () => {
    expect(dispositionFor(CHANGED_AGAIN)).toBe("stale");
  });

  // Restoring the wording restores the digest, so the verdict comes back
  // exactly as the decision record's own currency predicate behaves.
  it("comes back when the content is restored", () => {
    expect(dispositionFor(DECIDED_OVER)).toBe("accepted");
  });

  it("stays live when either side cannot say what the content is", () => {
    expect(dispositionFor(undefined)).toBe("accepted");
    expect(
      changeDispositionOf({
        address: { changeSetId: SET, from: FROM, to: TO, placeId: "p1" },
        accepted,
        rejected: new Set(),
        contentDigest: CHANGED_AGAIN,
      }),
    ).toBe("accepted");
  });

  it("counts a stale place as open work the reviewer has seen before", () => {
    expect(
      changeSetStanding({
        changeSetId: SET,
        from: FROM,
        to: TO,
        places: [
          { placeId: "p1", contentDigest: CHANGED_AGAIN },
          { placeId: "p2" },
        ],
        accepted,
        rejected: new Set(),
        decidedDigests,
      }),
    ).toEqual({
      total: 2,
      accepted: 0,
      rejected: 0,
      open: 2,
      stale: 1,
      isAccepted: false,
      isSettled: false,
    });
  });
});

describe("changeVerdictKey", () => {
  it("separates two places that share a revision", () => {
    expect(
      changeVerdictKey({ changeSetId: SET, from: FROM, to: TO, placeId: "p1" }),
    ).not.toBe(
      changeVerdictKey({ changeSetId: SET, from: FROM, to: TO, placeId: "p2" }),
    );
  });

  it("separates one place across two revisions", () => {
    expect(changeVerdictKey({ from: FROM, to: TO, placeId: "p1" })).not.toBe(
      changeVerdictKey({ from: TO, to: LATER, placeId: "p1" }),
    );
  });
});

describe("changeVerdictBatches", () => {
  const places = (count: number) =>
    Array.from({ length: count }, (_unused, index) => `p${index}`);

  it("leaves a gesture within the bound as one mutation", () => {
    const batches = changeVerdictBatches(places(VERDICT_BATCH_LIMIT));
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(VERDICT_BATCH_LIMIT);
  });

  it("splits a gesture past the bound into mutations the record accepts", () => {
    const all = places(VERDICT_BATCH_LIMIT * 2 + 3);
    const batches = changeVerdictBatches(all);
    expect(batches).toHaveLength(3);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(VERDICT_BATCH_LIMIT);
    }
    expect(batches.flatMap((batch) => [...batch])).toEqual(all);
  });

  it("has nothing to send for an empty gesture", () => {
    expect(changeVerdictBatches([])).toEqual([]);
  });
});
