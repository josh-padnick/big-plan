// Proves the Inputs panel never states more than it knows.
//
// Three situations reach this panel - still reading, read and nothing asked,
// and nobody could say - and each has to read as its own thing in both places
// the panel speaks. The failure to guard against is not a crash: it is a
// summary line asserting a conclusion over a body that is still waiting for
// one, which every reader takes at face value.

import { describe, expect, it } from "vitest";
import { inputsPanelReading } from "./inputs-surface.browser.js";
import {
  reviewInputStanding,
  type ReviewInput,
} from "../shared/input-contract.js";

const NOTHING = reviewInputStanding([]);

const oneOpenDecision = (): ReturnType<typeof reviewInputStanding> =>
  reviewInputStanding([
    {
      inputId: "quick-decision-do-we-ship-behind-a-flag",
      kind: "decision",
      label: "Do we ship behind a flag?",
      isCritical: true,
      state: "unanswered",
      detail: "No answer recorded",
    } satisfies ReviewInput,
  ]);

describe("what the Inputs panel says", () => {
  it("should say it is still reading in both places at once", () => {
    expect(
      inputsPanelReading({ standing: NOTHING, readStanding: "reading" }),
    ).toEqual({ summary: "Reading…", body: "reading" });
  });

  it("should call a read plan with no inputs empty rather than unread", () => {
    expect(
      inputsPanelReading({ standing: NOTHING, readStanding: "read" }),
    ).toEqual({ summary: "Nothing yet", body: "nothing" });
  });

  it("should refuse to say a review needs nothing when nobody could say", () => {
    expect(
      inputsPanelReading({ standing: NOTHING, readStanding: "unavailable" }),
    ).toEqual({ summary: "Not known", body: "unavailable" });
  });

  it("should give the three readings three different summaries", () => {
    const summaries = (["reading", "read", "unavailable"] as const).map(
      (readStanding) =>
        inputsPanelReading({ standing: NOTHING, readStanding }).summary,
    );

    expect(new Set(summaries).size).toBe(summaries.length);
  });

  // A contract the reviewer can already see outranks how the last read went:
  // a failed refetch must not take the list away or stop counting it.
  it("should keep counting the inputs it holds however the last read went", () => {
    for (const readStanding of ["reading", "read", "unavailable"] as const) {
      expect(
        inputsPanelReading({ standing: oneOpenDecision(), readStanding }),
      ).toEqual({ summary: "0 of 1 answered", body: "inputs" });
    }
  });
});
