// Covers the answers reader's own rule: a response older than the one this
// page already applied is dropped rather than shown.
//
// It is the losing half of a race a browser journey cannot cheaply provoke,
// because two overlapping reads of one record settling out of order is a
// timing accident rather than a reviewer's gesture. That the reader announces
// what it applies, and that the Inputs panel acts on the announcement, is
// proven where a reviewer would see it fail - over the live runtime in
// test/input-contract.spec.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAnswersRecord } from "./answers-record.browser.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const answersRecord = (revision: number) => ({
  revision,
  supersededDecisionIds: [],
  answers: [],
});

describe("applying an answers record", () => {
  it("should show every record at or past the one already applied", () => {
    vi.stubGlobal("document", new EventTarget());
    const applied = { current: -1 };
    const shown: Array<number> = [];

    for (const revision of [0, 1]) {
      expect(
        applyAnswersRecord({
          value: answersRecord(revision),
          applied,
          show: (state) => shown.push(state.revision),
        }),
      ).toBe(true);
    }

    expect(shown).toEqual([0, 1]);
    expect(applied.current).toBe(1);
  });

  it("should drop a record that lost a race to one already applied", () => {
    vi.stubGlobal("document", new EventTarget());
    const applied = { current: 4 };
    let shows = 0;

    expect(
      applyAnswersRecord({
        value: answersRecord(3),
        applied,
        show: () => {
          shows += 1;
        },
      }),
    ).toBe(false);

    expect(shows).toBe(0);
    expect(applied.current).toBe(4);
  });
});
