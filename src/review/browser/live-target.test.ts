// Covers the pure half of live-target: which match a name resolves to, whether
// its content identity still matches, and which miss reason wins. The DOM half
// is proven by the commenting browser journeys, per the testing ladder.

import { afterEach, describe, expect, it } from "vitest";
import {
  baselineMissReason,
  candidateMatchesLivePicture,
  liveBaselineBlock,
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

  it("should accept a hidden match when it is the only live one", () => {
    expect(
      pickLiveCandidate([candidate("collapsed-slide", { isVisible: false })]),
    ).toEqual({ found: "collapsed-slide" });
  });

  it("should keep input order when several live matches are displayed", () => {
    expect(
      pickLiveCandidate([candidate("first"), candidate("second")]),
    ).toEqual({ found: "first" });
  });
});

describe("baselineMissReason", () => {
  it("should report an unknown id in a retained snapshot", () => {
    expect(
      baselineMissReason({
        result: { missing: "unknown-id" },
        snapshotPresent: true,
      }),
    ).toEqual({ missing: "unknown-id" });
  });

  it("should report a missing snapshot when no live element carries it", () => {
    expect(
      baselineMissReason({
        result: { missing: "unknown-id" },
        snapshotPresent: false,
      }),
    ).toEqual({ missing: "snapshot-not-retained" });
  });

  it("should preserve clone-only misses in an available snapshot", () => {
    expect(
      baselineMissReason({
        result: { missing: "clone-only" },
        snapshotPresent: false,
      }),
    ).toEqual({ missing: "clone-only" });
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

describe("liveBaselineBlock", () => {
  const globals = globalThis as unknown as {
    CSS?: { escape(value: string): string };
    document?: {
      querySelector<TElement>(selector: string): TElement | null;
    };
  };
  const originalCSS = globals.CSS;
  const originalDocument = globals.document;

  afterEach(() => {
    globals.CSS = originalCSS;
    globals.document = originalDocument;
  });

  it("resolves qualified identity through both escaped baseline attributes", () => {
    const element = {
      closest: () => null,
      getClientRects: () => [{}],
    } as unknown as HTMLElement;
    const selectors: string[] = [];
    const article = {
      matches: () => false,
      querySelector: (selector: string) =>
        selector.includes("data-baseline-snapshot") ? element : null,
      querySelectorAll: (selector: string) => {
        selectors.push(selector);
        return [element];
      },
    };
    globals.CSS = {
      escape: (value) => `escaped(${value})`,
    };
    globals.document = {
      querySelector: () => article,
    };

    expect(liveBaselineBlock("block]id", "abcdef012345")).toEqual({
      found: element,
    });
    expect(selectors).toEqual([
      `[${"data-baseline-" + "block-id"}="escaped(block]id)"][${"data-baseline-" + "snapshot"}="escaped(abcdef012345)"]`,
    ]);
  });

  it("reports a missing snapshot without falling back to a proposed match", () => {
    const proposedElement = {
      closest: () => null,
      getClientRects: () => [{}],
    } as unknown as HTMLElement;
    const article = {
      matches: () => false,
      querySelector: () => null,
      querySelectorAll: (selector: string) =>
        selector.startsWith(`[${"data-block-id"}="`) ? [proposedElement] : [],
    };
    globals.CSS = { escape: (value) => value };
    globals.document = {
      querySelector: () => article,
    };

    expect(liveBaselineBlock("same-id", "abcdef012345")).toEqual({
      missing: "snapshot-not-retained",
    });
  });

  it("reports an unknown id when the requested snapshot is retained", () => {
    const article = {
      matches: () => false,
      querySelector: (selector: string) =>
        selector.includes("data-baseline-snapshot") ? {} : null,
      querySelectorAll: () => [],
    };
    globals.CSS = { escape: (value) => value };
    globals.document = {
      querySelector: () => article,
    };

    expect(liveBaselineBlock("missing-id", "abcdef012345")).toEqual({
      missing: "unknown-id",
    });
  });
});
