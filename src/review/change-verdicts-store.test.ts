// Proves the change-verdict record accepts only bounded, revision-scoped
// addresses, orders its writes, and refuses rather than trims at its bound.

import { describe, expect, it } from "vitest";
import {
  ACCEPTED_CHANGE_LIMIT,
  VERDICT_BATCH_LIMIT,
  PLACE_ID_LIMIT,
} from "./shared/change-verdict.js";
import {
  applyChangeVerdictMutation,
  validateChangeVerdictMutation,
  validateChangeVerdicts,
  type StoredChangeVerdicts,
} from "./change-verdicts-store.js";

const FROM = "aaaaaaaaaaaaaaaa";
const TO = "bbbbbbbbbbbbbbbb";
const LATER = "cccccccccccccccc";
const NOW = "2026-08-18T00:00:00.000Z";

const empty: StoredChangeVerdicts = {
  version: 1,
  revision: 0,
  accepted: [],
};

const accept = (placeIds: ReadonlyArray<string>, to = TO) =>
  validateChangeVerdictMutation({
    value: { op: "accept", from: FROM, to, placeIds },
    now: NOW,
  });

describe("validateChangeVerdicts", () => {
  it("reads an absent record as an empty one at revision zero", () => {
    expect(validateChangeVerdicts(undefined)).toEqual(empty);
  });

  it("refuses a record of another version", () => {
    expect(() =>
      validateChangeVerdicts({ version: 2, revision: 0, accepted: [] }),
    ).toThrow(/version 1 record/u);
  });

  it("refuses an address that is not a snapshot digest", () => {
    expect(() =>
      validateChangeVerdicts({
        version: 1,
        revision: 1,
        accepted: [
          { from: "not-a-digest", to: TO, placeId: "p1", acceptedAt: NOW },
        ],
      }),
    ).toThrow(/hexadecimal snapshot digest/u);
  });

  it("refuses a place id longer than the bound", () => {
    expect(() =>
      validateChangeVerdicts({
        version: 1,
        revision: 1,
        accepted: [
          {
            from: FROM,
            to: TO,
            placeId: "p".repeat(PLACE_ID_LIMIT + 1),
            acceptedAt: NOW,
          },
        ],
      }),
    ).toThrow(new RegExp(`longer than ${PLACE_ID_LIMIT}`, "u"));
  });

  it("refuses two entries for the same change", () => {
    expect(() =>
      validateChangeVerdicts({
        version: 1,
        revision: 1,
        accepted: [
          { from: FROM, to: TO, placeId: "p1", acceptedAt: NOW },
          { from: FROM, to: TO, placeId: "p1", acceptedAt: NOW },
        ],
      }),
    ).toThrow(/only one entry per change/u);
  });

  it("keeps the same place id under two different revisions apart", () => {
    const stored = validateChangeVerdicts({
      version: 1,
      revision: 3,
      accepted: [
        { from: FROM, to: TO, placeId: "p1", acceptedAt: NOW },
        { from: TO, to: LATER, placeId: "p1", acceptedAt: NOW },
      ],
    });
    expect(stored.accepted).toHaveLength(2);
  });
});

describe("validateChangeVerdictMutation", () => {
  it("stamps the acceptance time from the server clock", () => {
    expect(
      validateChangeVerdictMutation({
        value: {
          op: "accept",
          from: FROM,
          to: TO,
          placeIds: ["p1"],
          acceptedAt: "1999-01-01T00:00:00.000Z",
        },
        now: NOW,
      }).acceptedAt,
    ).toBe(NOW);
  });

  it("refuses an unknown operation", () => {
    expect(() =>
      validateChangeVerdictMutation({
        value: { op: "reject", from: FROM, to: TO, placeIds: ["p1"] },
        now: NOW,
      }),
    ).toThrow(/"accept" or "withdraw"/u);
  });

  // A place id is the caller's own address for one part of a diff, so it is
  // stored exactly as given: a trimmed id would accept a place nobody named.
  it("keeps a place id exactly as the caller wrote it", () => {
    expect(
      validateChangeVerdictMutation({
        value: { op: "accept", from: FROM, to: TO, placeIds: [" p1 "] },
        now: NOW,
      }).placeIds,
    ).toEqual([" p1 "]);
  });

  it("refuses a place id that is only whitespace", () => {
    expect(() =>
      validateChangeVerdictMutation({
        value: { op: "accept", from: FROM, to: TO, placeIds: ["   "] },
        now: NOW,
      }),
    ).toThrow(/non-empty text/u);
  });

  it("refuses a mutation that names no change", () => {
    expect(() =>
      validateChangeVerdictMutation({
        value: { op: "accept", from: FROM, to: TO, placeIds: [] },
        now: NOW,
      }),
    ).toThrow(/must name a change/u);
  });

  it("refuses a batch past its bound", () => {
    expect(() =>
      validateChangeVerdictMutation({
        value: {
          op: "accept",
          from: FROM,
          to: TO,
          placeIds: Array.from(
            { length: VERDICT_BATCH_LIMIT + 1 },
            (_, index) => `p${index}`,
          ),
        },
        now: NOW,
      }),
    ).toThrow(new RegExp(`more than ${VERDICT_BATCH_LIMIT}`, "u"));
  });

  it("refuses a batch that repeats one change", () => {
    expect(() =>
      validateChangeVerdictMutation({
        value: { op: "accept", from: FROM, to: TO, placeIds: ["p1", "p1"] },
        now: NOW,
      }),
    ).toThrow(/repeats a change/u);
  });
});

describe("applyChangeVerdictMutation", () => {
  it("records an acceptance and advances the revision", () => {
    const next = applyChangeVerdictMutation({
      verdicts: empty,
      mutation: accept(["p1", "p2"]),
    });
    expect(next.revision).toBe(1);
    expect(next.accepted).toEqual([
      { from: FROM, to: TO, placeId: "p1", acceptedAt: NOW },
      { from: FROM, to: TO, placeId: "p2", acceptedAt: NOW },
    ]);
  });

  it("leaves the record it was given unchanged", () => {
    const before: StoredChangeVerdicts = {
      version: 1,
      revision: 4,
      accepted: [{ from: FROM, to: TO, placeId: "p1", acceptedAt: NOW }],
    };
    applyChangeVerdictMutation({
      verdicts: before,
      mutation: accept(["p2"]),
    });
    expect(before.accepted).toHaveLength(1);
  });

  it("re-accepting a recorded change stores one entry, not two", () => {
    const once = applyChangeVerdictMutation({
      verdicts: empty,
      mutation: accept(["p1"]),
    });
    const twice = applyChangeVerdictMutation({
      verdicts: once,
      mutation: accept(["p1"]),
    });
    expect(twice.accepted).toHaveLength(1);
    expect(twice.revision).toBe(2);
  });

  it("withdraws only the changes it names, and still advances", () => {
    const accepted = applyChangeVerdictMutation({
      verdicts: empty,
      mutation: accept(["p1", "p2"]),
    });
    const withdrawn = applyChangeVerdictMutation({
      verdicts: accepted,
      mutation: validateChangeVerdictMutation({
        value: { op: "withdraw", from: FROM, to: TO, placeIds: ["p1"] },
        now: NOW,
      }),
    });
    expect(withdrawn.revision).toBe(2);
    expect(withdrawn.accepted.map((entry) => entry.placeId)).toEqual(["p2"]);
  });

  it("leaves the same place accepted under another revision alone", () => {
    const both = applyChangeVerdictMutation({
      verdicts: applyChangeVerdictMutation({
        verdicts: empty,
        mutation: accept(["p1"]),
      }),
      mutation: accept(["p1"], LATER),
    });
    const withdrawn = applyChangeVerdictMutation({
      verdicts: both,
      mutation: validateChangeVerdictMutation({
        value: { op: "withdraw", from: FROM, to: TO, placeIds: ["p1"] },
        now: NOW,
      }),
    });
    expect(withdrawn.accepted).toEqual([
      { from: FROM, to: LATER, placeId: "p1", acceptedAt: NOW },
    ]);
  });

  // Trimming to fit would silently reopen a change set the reviewer closed, so
  // the record refuses the write instead and the browser reports the refusal.
  it("refuses to grow past the record bound rather than dropping the oldest", () => {
    const full: StoredChangeVerdicts = {
      version: 1,
      revision: 1,
      accepted: Array.from({ length: ACCEPTED_CHANGE_LIMIT }, (_, index) => ({
        from: FROM,
        to: TO,
        placeId: `p${index}`,
        acceptedAt: NOW,
      })),
    };
    expect(() =>
      applyChangeVerdictMutation({
        verdicts: full,
        mutation: accept(["beyond-the-bound"]),
      }),
    ).toThrow(new RegExp(`at most ${ACCEPTED_CHANGE_LIMIT}`, "u"));
  });
});
