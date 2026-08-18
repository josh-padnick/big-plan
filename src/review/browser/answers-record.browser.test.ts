// Proves the chain that keeps the Inputs panel and the decision cards telling
// one story about the same review: applying a newer answers record announces
// it, and the panel's own subscription reads the contract again when it hears
// that announcement.
//
// The failure this covers is silent, and was found only by looking: the panel
// said Stale while the card two inches away still said Answer recorded. Break
// either link - the reader stops announcing, or the panel stops listening -
// and nothing throws. So both links are exercised here through the interfaces
// the controller and the panel actually call.

import { afterEach, describe, expect, it, vi } from "vitest";
import { applyAnswersRecord } from "./answers-record.browser.js";
import { watchReviewInputContract } from "./inputs-surface.browser.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const answersRecord = ({
  revision,
  decisionId,
}: {
  readonly revision: number;
  readonly decisionId: string;
}) => ({
  revision,
  supersededDecisionIds: [],
  answers: [
    {
      decisionId,
      optionId: `${decisionId}-option-yes`,
      optionTitle: "Yes",
      prompt: "Do we ship behind a flag?",
      answeredAt: "2026-08-18T00:00:00.000Z",
      premiseSnapshot: "0123456789abcdef",
      decisionDigest: "fedcba9876543210",
    },
  ],
});

/** A page whose Inputs panel is watching, and the reads it has made. */
const watchingPage = (): {
  readonly reads: () => number;
  readonly stopWatching: () => void;
} => {
  vi.stubGlobal("document", new EventTarget());
  let reads = 0;
  const stopWatching = watchReviewInputContract(() => {
    reads += 1;
  });
  return { reads: () => reads, stopWatching };
};

describe("the Inputs panel's view of an applied answers record", () => {
  it("should read the contract as soon as the panel starts watching", () => {
    expect(watchingPage().reads()).toBe(1);
  });

  it("should read it again every time this page applies a newer record", () => {
    const page = watchingPage();
    const applied = { current: -1 };
    const shown: Array<number> = [];

    for (const revision of [0, 1]) {
      expect(
        applyAnswersRecord({
          value: answersRecord({ revision, decisionId: "decision-one" }),
          applied,
          show: (state) => shown.push(state.answers.length),
        }),
      ).toBe(true);
    }

    expect(shown).toEqual([1, 1]);
    expect(applied.current).toBe(1);
    expect(page.reads()).toBe(3);
  });

  it("should stay put when a record that lost a race arrives", () => {
    const page = watchingPage();
    const applied = { current: 4 };
    let shows = 0;

    expect(
      applyAnswersRecord({
        value: answersRecord({ revision: 3, decisionId: "decision-one" }),
        applied,
        show: () => {
          shows += 1;
        },
      }),
    ).toBe(false);

    expect(shows).toBe(0);
    expect(applied.current).toBe(4);
    expect(page.reads()).toBe(1);
  });

  it("should stop reading once the panel has gone", () => {
    const page = watchingPage();
    page.stopWatching();

    applyAnswersRecord({
      value: answersRecord({ revision: 0, decisionId: "decision-one" }),
      applied: { current: -1 },
      show: () => undefined,
    });

    expect(page.reads()).toBe(1);
  });
});
