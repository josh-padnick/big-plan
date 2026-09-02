// Proves the change-verdict record accepts only bounded, revision-scoped
// addresses, records each of its two verdicts, orders its writes, and refuses
// rather than trims at its bound.

import { describe, expect, it } from "vitest";
import {
  DECIDED_CHANGE_LIMIT,
  VERDICT_BATCH_LIMIT,
  PLACE_ID_LIMIT,
} from "./shared/change-verdict.js";
import {
  applyChangeVerdictMutation,
  mergeFinalizedChangeVerdicts,
  rejectedPlaceIdsFor,
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
  decided: [],
};

const row = ({
  from = FROM,
  to = TO,
  placeId,
  verdict = "accepted" as const,
  actor,
}: {
  readonly from?: string;
  readonly to?: string;
  readonly placeId: string;
  readonly verdict?: "accepted" | "rejected";
  readonly actor?: string;
}) => ({
  from,
  to,
  placeId,
  verdict,
  decidedAt: NOW,
  ...(actor === undefined ? {} : { actor }),
});

const mutate = (
  op: "accept" | "reject" | "undo",
  placeIds: ReadonlyArray<string>,
  to = TO,
) =>
  validateChangeVerdictMutation({
    value: { op, from: FROM, to, placeIds },
    now: NOW,
  });

const accept = (placeIds: ReadonlyArray<string>, to = TO) =>
  mutate("accept", placeIds, to);

describe("validateChangeVerdicts", () => {
  it("reads an absent record as an empty one at revision zero", () => {
    expect(validateChangeVerdicts(undefined)).toEqual(empty);
  });

  it("refuses a record of another version", () => {
    expect(() =>
      validateChangeVerdicts({ version: 2, revision: 0, decided: [] }),
    ).toThrow(/version 1 record/u);
  });

  it("refuses an address that is not a snapshot digest", () => {
    expect(() =>
      validateChangeVerdicts({
        version: 1,
        revision: 1,
        decided: [row({ from: "not-a-digest", placeId: "p1" })],
      }),
    ).toThrow(/hexadecimal snapshot digest/u);
  });

  it("refuses a place id longer than the bound", () => {
    expect(() =>
      validateChangeVerdicts({
        version: 1,
        revision: 1,
        decided: [row({ placeId: "p".repeat(PLACE_ID_LIMIT + 1) })],
      }),
    ).toThrow(new RegExp(`longer than ${PLACE_ID_LIMIT}`, "u"));
  });

  it("refuses two entries for the same change", () => {
    expect(() =>
      validateChangeVerdicts({
        version: 1,
        revision: 1,
        decided: [row({ placeId: "p1" }), row({ placeId: "p1" })],
      }),
    ).toThrow(/only one entry per change/u);
  });

  it("keeps the same place id under two different revisions apart", () => {
    const stored = validateChangeVerdicts({
      version: 1,
      revision: 3,
      decided: [
        row({ placeId: "p1" }),
        row({ from: TO, to: LATER, placeId: "p1" }),
      ],
    });
    expect(stored.decided).toHaveLength(2);
  });

  it("preserves a known actor and treats its absence as a reviewer row", () => {
    const stored = validateChangeVerdicts({
      version: 1,
      revision: 2,
      decided: [
        row({ placeId: "p1" }),
        row({
          from: TO,
          to: LATER,
          placeId: "p2",
          actor: "auto-accept",
        }),
      ],
    });
    expect(stored.decided).toEqual([
      row({ placeId: "p1" }),
      row({ from: TO, to: LATER, placeId: "p2", actor: "auto-accept" }),
    ]);
  });

  it("refuses an unknown verdict actor", () => {
    expect(() =>
      validateChangeVerdicts({
        version: 1,
        revision: 1,
        decided: [row({ placeId: "p1", actor: "mode" })],
      }),
    ).toThrow(/"reviewer" or "auto-accept"/u);
  });
});

describe("validateChangeVerdictMutation", () => {
  it("stamps the decision time from the server clock", () => {
    const mutation = validateChangeVerdictMutation({
      value: {
        op: "accept",
        from: FROM,
        to: TO,
        placeIds: ["p1"],
        decidedAt: "1999-01-01T00:00:00.000Z",
        actor: "auto-accept",
      },
      now: NOW,
    });
    expect(mutation.decidedAt).toBe(NOW);
    expect(mutation.actor).toBe("reviewer");
  });

  it("accepts each of the three operations a reviewer can send", () => {
    for (const op of ["accept", "reject", "undo"] as const) {
      expect(mutate(op, ["p1"]).op).toBe(op);
    }
  });

  it("refuses an unknown operation", () => {
    expect(() =>
      validateChangeVerdictMutation({
        value: { op: "withdraw", from: FROM, to: TO, placeIds: ["p1"] },
        now: NOW,
      }),
    ).toThrow(/"accept", "reject" or "undo"/u);
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
    expect(next.decided).toEqual([
      row({ placeId: "p1", actor: "reviewer" }),
      row({ placeId: "p2", actor: "reviewer" }),
    ]);
  });

  it("records a rejection under the same address an acceptance uses", () => {
    const next = applyChangeVerdictMutation({
      verdicts: empty,
      mutation: mutate("reject", ["p1"]),
    });
    expect(next.revision).toBe(1);
    expect(next.decided).toEqual([
      row({ placeId: "p1", verdict: "rejected", actor: "reviewer" }),
    ]);
  });

  // Undo returns a change to undecided whichever way it had been decided, and
  // undecided is the absence of a row, so an undone change is once more exactly
  // what it was before anyone answered it.
  it("undoes a rejection back to undecided", () => {
    const rejected = applyChangeVerdictMutation({
      verdicts: empty,
      mutation: mutate("reject", ["p1", "p2"]),
    });
    const undone = applyChangeVerdictMutation({
      verdicts: rejected,
      mutation: mutate("undo", ["p1"]),
    });
    expect(undone.revision).toBe(2);
    expect(undone.decided).toEqual([
      row({ placeId: "p2", verdict: "rejected", actor: "reviewer" }),
    ]);
  });

  it("replaces a verdict rather than holding both when a change is re-decided", () => {
    const accepted = applyChangeVerdictMutation({
      verdicts: empty,
      mutation: accept(["p1"]),
    });
    const rejected = applyChangeVerdictMutation({
      verdicts: accepted,
      mutation: mutate("reject", ["p1"]),
    });
    expect(rejected.decided).toEqual([
      row({ placeId: "p1", verdict: "rejected", actor: "reviewer" }),
    ]);
  });

  // Undecided is a live state, not an ending: an undone change is waiting for
  // an answer again, and either answer is still available to it. Both
  // directions are asserted because a record that only re-accepted, or only
  // re-rejected, would still pass a single-direction check.
  it("leaves an undone change open to either verdict again", () => {
    for (const op of ["accept", "reject"] as const) {
      const decided = applyChangeVerdictMutation({
        verdicts: applyChangeVerdictMutation({
          verdicts: applyChangeVerdictMutation({
            verdicts: empty,
            mutation: mutate("reject", ["p1"]),
          }),
          mutation: mutate("undo", ["p1"]),
        }),
        mutation: mutate(op, ["p1"]),
      });
      expect(decided.decided).toEqual([
        row({
          placeId: "p1",
          verdict: op === "accept" ? "accepted" : "rejected",
          actor: "reviewer",
        }),
      ]);
    }
  });

  it("names only the rejected places of one revision", () => {
    const decided = applyChangeVerdictMutation({
      verdicts: applyChangeVerdictMutation({
        verdicts: applyChangeVerdictMutation({
          verdicts: empty,
          mutation: mutate("reject", ["p1"]),
        }),
        mutation: accept(["p2"]),
      }),
      mutation: mutate("reject", ["p3"], LATER),
    });
    expect(
      rejectedPlaceIdsFor({ verdicts: decided, from: FROM, to: TO }),
    ).toEqual(["p1"]);
    expect(
      rejectedPlaceIdsFor({ verdicts: decided, from: FROM, to: LATER }),
    ).toEqual(["p3"]);
  });

  it("leaves the record it was given unchanged", () => {
    const before: StoredChangeVerdicts = {
      version: 1,
      revision: 4,
      decided: [row({ placeId: "p1" })],
    };
    applyChangeVerdictMutation({
      verdicts: before,
      mutation: accept(["p2"]),
    });
    expect(before.decided).toHaveLength(1);
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
    expect(twice.decided).toHaveLength(1);
    expect(twice.revision).toBe(2);
  });

  it("undoes only the changes it names, and still advances", () => {
    const accepted = applyChangeVerdictMutation({
      verdicts: empty,
      mutation: accept(["p1", "p2"]),
    });
    const undone = applyChangeVerdictMutation({
      verdicts: accepted,
      mutation: mutate("undo", ["p1"]),
    });
    expect(undone.revision).toBe(2);
    expect(undone.decided.map((entry) => entry.placeId)).toEqual(["p2"]);
  });

  it("leaves the same place accepted under another revision alone", () => {
    const both = applyChangeVerdictMutation({
      verdicts: applyChangeVerdictMutation({
        verdicts: empty,
        mutation: accept(["p1"]),
      }),
      mutation: accept(["p1"], LATER),
    });
    const undone = applyChangeVerdictMutation({
      verdicts: both,
      mutation: mutate("undo", ["p1"]),
    });
    expect(undone.decided).toEqual([
      row({ from: FROM, to: LATER, placeId: "p1", actor: "reviewer" }),
    ]);
  });

  // Trimming to fit would silently reopen a change set the reviewer closed, so
  // the record refuses the write instead and the browser reports the refusal.
  it("refuses to grow past the record bound rather than dropping the oldest", () => {
    const full: StoredChangeVerdicts = {
      version: 1,
      revision: 1,
      decided: Array.from({ length: DECIDED_CHANGE_LIMIT }, (_, index) =>
        row({ placeId: `p${index}` }),
      ),
    };
    expect(() =>
      applyChangeVerdictMutation({
        verdicts: full,
        mutation: accept(["beyond-the-bound"]),
      }),
    ).toThrow(new RegExp(`at most ${DECIDED_CHANGE_LIMIT}`, "u"));
  });
});

describe("mergeFinalizedChangeVerdicts", () => {
  it("should preserve a concurrent acceptance when approval finalizes", () => {
    const finalized = applyChangeVerdictMutation({
      verdicts: empty,
      mutation: accept(["approved"]),
    });
    const current = applyChangeVerdictMutation({
      verdicts: finalized,
      mutation: accept(["concurrent"]),
    });

    const merged = mergeFinalizedChangeVerdicts({ current, finalized });

    expect(merged.revision).toBe(2);
    expect(merged.decided.map((entry) => entry.placeId)).toEqual([
      "approved",
      "concurrent",
    ]);
  });

  it("should leave an already finalized record unchanged during recovery", () => {
    const finalized = applyChangeVerdictMutation({
      verdicts: empty,
      mutation: accept(["approved"]),
    });

    expect(
      mergeFinalizedChangeVerdicts({ current: finalized, finalized }),
    ).toBe(finalized);
  });
});
