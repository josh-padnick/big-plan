// Proves the one selector every surface counts a change set with: what is
// closed, what is still open, and when a set counts as accepted.

import { describe, expect, it } from "vitest";
import {
  acceptedChangeKeys,
  changeDispositionKey,
  changeSetStanding,
} from "./change-disposition.js";

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

describe("changeDispositionKey", () => {
  it("separates two places that share a revision", () => {
    expect(
      changeDispositionKey({ from: FROM, to: TO, placeId: "p1" }),
    ).not.toBe(changeDispositionKey({ from: FROM, to: TO, placeId: "p2" }));
  });

  it("separates one place across two revisions", () => {
    expect(
      changeDispositionKey({ from: FROM, to: TO, placeId: "p1" }),
    ).not.toBe(changeDispositionKey({ from: TO, to: LATER, placeId: "p1" }));
  });
});
