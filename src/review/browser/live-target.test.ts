// Covers the pure half of live-target: which match a name resolves to, and
// which reason a lens anchor reports when no match survives. The DOM half is
// proven by the commenting browser journeys, per the testing ladder.

import { describe, expect, it } from "vitest";
import {
  lensMissReason,
  pickLiveCandidate,
  type LiveCandidate,
} from "./live-target.browser.js";

const candidate = (
  name: string,
  { isLensCopy = false, isVisible = true } = {},
): LiveCandidate<string> => ({ element: name, isLensCopy, isVisible });

describe("pickLiveCandidate", () => {
  it("should report an unknown id when nothing carries the name", () => {
    expect(pickLiveCandidate([])).toEqual({ missing: "unknown-id" });
  });

  it("should report a clone-only miss when every match is a lens copy", () => {
    expect(
      pickLiveCandidate([
        candidate("lens-was", { isLensCopy: true }),
        candidate("lens-now", { isLensCopy: true }),
      ]),
    ).toEqual({ missing: "clone-only" });
  });

  it("should prefer the displayed match when a hidden one comes first", () => {
    expect(
      pickLiveCandidate([
        candidate("dark-variant", { isVisible: false }),
        candidate("light-variant"),
      ]),
    ).toEqual({ found: "light-variant" });
  });

  it("should accept a hidden match when it is the only live one", () => {
    expect(
      pickLiveCandidate([candidate("collapsed-slide", { isVisible: false })]),
    ).toEqual({ found: "collapsed-slide" });
  });

  it("should never answer with a lens copy when a live match exists", () => {
    expect(
      pickLiveCandidate([
        candidate("lens-copy", { isLensCopy: true }),
        candidate("reading-copy", { isVisible: false }),
      ]),
    ).toEqual({ found: "reading-copy" });
  });

  it("should keep input order when several live matches are displayed", () => {
    expect(
      pickLiveCandidate([candidate("first"), candidate("second")]),
    ).toEqual({ found: "first" });
  });
});

describe("lensMissReason", () => {
  it("should report an unknown id when no candidate existed", () => {
    expect(lensMissReason([])).toBe("unknown-id");
  });

  it("should report drift when a candidate resolved but named other content", () => {
    expect(lensMissReason(["unknown-id", "drifted-content"])).toBe(
      "drifted-content",
    );
  });

  it("should report drift ahead of a clone-only match", () => {
    expect(lensMissReason(["clone-only", "drifted-content"])).toBe(
      "drifted-content",
    );
  });

  it("should propagate a clone-only match over a plain absence", () => {
    expect(lensMissReason(["unknown-id", "clone-only"])).toBe("clone-only");
  });
});
