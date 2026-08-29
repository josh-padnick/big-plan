// Covers the pure half of live-target: which match a name resolves to, whether
// its content identity still matches, and which miss reason wins. The DOM half
// is proven by the commenting browser journeys, per the testing ladder.

import { describe, expect, it } from "vitest";
import {
  candidateMatchesLivePicture,
  lensMissReason,
  pickLiveCandidate,
  type LiveCandidate,
} from "./live-target.browser.js";

const candidate = (
  name: string,
  { isVisible = true } = {},
): LiveCandidate<string> => ({ element: name, isVisible });

describe("pickLiveCandidate", () => {
  it("should report an unknown id when nothing carries the name", () => {
    expect(pickLiveCandidate([])).toEqual({ missing: "unknown-id" });
  });

  it("should prefer the displayed match when a hidden one comes first", () => {
    expect(
      pickLiveCandidate([
        candidate("dark-variant", { isVisible: false }),
        candidate("light-variant"),
      ]),
    ).toEqual({ found: "light-variant" });
  });

  it("should accept a hidden match when it is the only one", () => {
    expect(
      pickLiveCandidate([candidate("collapsed-slide", { isVisible: false })]),
    ).toEqual({ found: "collapsed-slide" });
  });

  it("should keep input order when several matches are displayed", () => {
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
});

describe("candidateMatchesLivePicture", () => {
  const historicalCandidate = {
    blockId: "approach/image-1",
    placement: "replace" as const,
    expectedPicture: {
      aspect: "image" as const,
      source: "./assets/b.png",
      alt: "Map",
    },
  };

  it("should reject a live picture from a later revision", () => {
    expect(
      candidateMatchesLivePicture({
        candidate: historicalCandidate,
        livePicture: { source: "./assets/c.png", alt: "Map" },
      }),
    ).toBe(false);
    expect(
      candidateMatchesLivePicture({
        candidate: historicalCandidate,
        livePicture: { source: "./assets/b.png", alt: "Updated map" },
      }),
    ).toBe(false);
  });

  it("should trust the picture recorded by the historical candidate", () => {
    expect(
      candidateMatchesLivePicture({
        candidate: historicalCandidate,
        livePicture: { source: "./assets/b.png", alt: "Map" },
      }),
    ).toBe(true);
  });
});
