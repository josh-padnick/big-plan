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
  rejectedChangeKeys,
  VERDICT_BATCH_LIMIT,
} from "./change-verdict.js";

const FROM = "aaaaaaaaaaaaaaaa";
const TO = "bbbbbbbbbbbbbbbb";
const LATER = "cccccccccccccccc";
const NOW = "2026-08-18T00:00:00.000Z";

const stateOf = (
  entries: ReadonlyArray<{
    from: string;
    to: string;
    placeId: string;
    verdict?: "accepted" | "rejected";
  }>,
) => ({
  revision: 1,
  decided: entries.map(({ verdict = "accepted" as const, ...address }) => ({
    ...address,
    verdict,
    decidedAt: NOW,
  })),
});

const keys = (
  entries: ReadonlyArray<{ from: string; to: string; placeId: string }>,
) => acceptedChangeKeys(stateOf(entries));

const rejectedKeys = (
  entries: ReadonlyArray<{ from: string; to: string; placeId: string }>,
) =>
  rejectedChangeKeys(
    stateOf(
      entries.map((entry) => ({ ...entry, verdict: "rejected" as const })),
    ),
  );

describe("changeSetStanding", () => {
  it("counts an untouched set as wholly open", () => {
    expect(
      changeSetStanding({
        from: FROM,
        to: TO,
        placeIds: ["p1", "p2", "p3"],
        accepted: new Set(),
        rejected: new Set(),
      }),
    ).toEqual({
      total: 3,
      accepted: 0,
      rejected: 0,
      open: 3,
      isAccepted: false,
      isSettled: false,
    });
  });

  it("counts a partly accepted set", () => {
    expect(
      changeSetStanding({
        from: FROM,
        to: TO,
        placeIds: ["p1", "p2", "p3"],
        accepted: keys([{ from: FROM, to: TO, placeId: "p2" }]),
        rejected: new Set(),
      }),
    ).toEqual({
      total: 3,
      accepted: 1,
      rejected: 0,
      open: 2,
      isAccepted: false,
      isSettled: false,
    });
  });

  it("calls a set accepted only when nothing in it is open", () => {
    expect(
      changeSetStanding({
        from: FROM,
        to: TO,
        placeIds: ["p1", "p2"],
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
      isAccepted: true,
      isSettled: true,
    });
  });

  // A change set with nothing in it was never closed by a reviewer, and
  // reporting it as accepted would credit work that never happened.
  it("does not call an empty set accepted", () => {
    expect(
      changeSetStanding({
        from: FROM,
        to: TO,
        placeIds: [],
        accepted: new Set(),
        rejected: new Set(),
      }),
    ).toEqual({
      total: 0,
      accepted: 0,
      rejected: 0,
      open: 0,
      isAccepted: false,
      isSettled: false,
    });
  });

  // The address carries both snapshot digests, so acceptance recorded against
  // one revision can never be counted against the revision that replaced it.
  it("does not count an acceptance recorded against another revision", () => {
    expect(
      changeSetStanding({
        from: TO,
        to: LATER,
        placeIds: ["p1"],
        accepted: keys([{ from: FROM, to: TO, placeId: "p1" }]),
        rejected: new Set(),
      }),
    ).toEqual({
      total: 1,
      accepted: 0,
      rejected: 0,
      open: 1,
      isAccepted: false,
      isSettled: false,
    });
  });

  it("ignores a stored acceptance for a place this set does not hold", () => {
    expect(
      changeSetStanding({
        from: FROM,
        to: TO,
        placeIds: ["p1"],
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
      isAccepted: true,
      isSettled: true,
    });
  });

  it("counts a rejected place as decided rather than open", () => {
    expect(
      changeSetStanding({
        from: FROM,
        to: TO,
        placeIds: ["p1", "p2"],
        accepted: keys([{ from: FROM, to: TO, placeId: "p1" }]),
        rejected: rejectedKeys([{ from: FROM, to: TO, placeId: "p2" }]),
      }),
    ).toEqual({
      total: 2,
      accepted: 1,
      rejected: 1,
      open: 0,
      isAccepted: false,
      isSettled: true,
    });
  });

  // A set the reviewer rejected outright is finished with, but calling it
  // accepted would report that the plan kept work it explicitly took out.
  it("settles a wholly rejected set without calling it accepted", () => {
    expect(
      changeSetStanding({
        from: FROM,
        to: TO,
        placeIds: ["p1"],
        accepted: new Set(),
        rejected: rejectedKeys([{ from: FROM, to: TO, placeId: "p1" }]),
      }),
    ).toEqual({
      total: 1,
      accepted: 0,
      rejected: 1,
      open: 0,
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
      changeVerdictKey({ from: FROM, to: TO, placeId: "p1" }),
    ]);
    expect([...rejectedChangeKeys(state)]).toEqual([
      changeVerdictKey({ from: FROM, to: TO, placeId: "p2" }),
    ]);
  });
});

describe("changeVerdictKey", () => {
  it("separates two places that share a revision", () => {
    expect(changeVerdictKey({ from: FROM, to: TO, placeId: "p1" })).not.toBe(
      changeVerdictKey({ from: FROM, to: TO, placeId: "p2" }),
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
