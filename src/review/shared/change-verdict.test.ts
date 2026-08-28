// Proves the one selector every surface counts a change set with: what is
// closed, what is still open, and when a set counts as accepted.

import { describe, expect, it } from "vitest";
import {
  acceptedChangeKeys,
  changeVerdictBatches,
  changeVerdictKey,
  changeSetStanding,
  VERDICT_BATCH_LIMIT,
} from "./change-verdict.js";

const FROM = "aaaaaaaaaaaaaaaa";
const TO = "bbbbbbbbbbbbbbbb";
const LATER = "cccccccccccccccc";
const NOW = "2026-08-18T00:00:00.000Z";

const keys = (
  entries: ReadonlyArray<{ from: string; to: string; placeId: string }>,
) =>
  acceptedChangeKeys({
    revision: 1,
    accepted: entries.map((entry) => ({ ...entry, acceptedAt: NOW })),
  });

describe("changeSetStanding", () => {
  it("counts an untouched set as wholly open", () => {
    expect(
      changeSetStanding({
        from: FROM,
        to: TO,
        placeIds: ["p1", "p2", "p3"],
        accepted: new Set(),
      }),
    ).toEqual({ total: 3, accepted: 0, open: 3, isAccepted: false });
  });

  it("counts a partly accepted set", () => {
    expect(
      changeSetStanding({
        from: FROM,
        to: TO,
        placeIds: ["p1", "p2", "p3"],
        accepted: keys([{ from: FROM, to: TO, placeId: "p2" }]),
      }),
    ).toEqual({ total: 3, accepted: 1, open: 2, isAccepted: false });
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
      }),
    ).toEqual({ total: 2, accepted: 2, open: 0, isAccepted: true });
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
      }),
    ).toEqual({ total: 0, accepted: 0, open: 0, isAccepted: false });
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
      }),
    ).toEqual({ total: 1, accepted: 0, open: 1, isAccepted: false });
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
      }),
    ).toEqual({ total: 1, accepted: 1, open: 0, isAccepted: true });
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
