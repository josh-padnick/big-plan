// Covers the pure half of live-target: which match a name resolves to, whether
// its content identity still matches, and which miss reason wins. The DOM half
// is proven by the commenting browser journeys, per the testing ladder.

import { afterEach, describe, expect, it } from "vitest";
import {
  isPlanDomBehind,
  publishPlanSnapshots,
  baselineMissReason,
  candidateMatchesLivePicture,
  liveBaselineBlock,
  liveLensAnchor,
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

describe("liveLensAnchor", () => {
  const globals = globalThis as unknown as {
    CSS?: { escape(value: string): string };
    HTMLElement?: unknown;
    document?: {
      querySelector<TElement>(selector: string): TElement | null;
    };
  };
  const originalCSS = globals.CSS;
  const originalDocument = globals.document;
  const originalHTMLElement = globals.HTMLElement;

  afterEach(() => {
    globals.CSS = originalCSS;
    globals.document = originalDocument;
    globals.HTMLElement = originalHTMLElement;
  });

  const componentLocation = {
    status: "changed",
    isComponentRoot: true,
    scope: "section/approach",
    kind: "data-table",
    label: "Rollout gates",
    section: "Approach",
    newBlockId: "approach/data-table-1",
    oldText: "was",
    newText: "now",
    runs: [],
    view: "<figure data-component-diff></figure>",
  } as const;

  const articleHolding = (blockKind: string) => {
    const element = {
      closest: () => null,
      getClientRects: () => [{}],
      dataset: { blockKind },
      // liveBlockText clones the block and strips injected chrome before
      // reading it, so the stub answers that shape.
      cloneNode: () => ({
        querySelectorAll: () => [] as ReadonlyArray<never>,
        textContent: "whatever the block says now",
      }),
      matches: () => false,
      querySelector: () => null,
    } as unknown as HTMLElement;
    globals.CSS = { escape: (value) => value };
    // liveBlockText narrows its clone with `instanceof HTMLElement`; the stub
    // is deliberately not one, so the text falls back to textContent - which
    // is what this suite wants, since the kind is the fact under test.
    globals.HTMLElement = class {};
    globals.document = {
      querySelector: () => ({ querySelectorAll: () => [element] }),
    } as never;
    return element;
  };

  it("should place a superseded component beside a block of the kind it named", () => {
    // The change is about this component, revised again. Its words have moved
    // on, which is exactly why the text is not what it is held to.
    const element = articleHolding("data-table");
    expect(liveLensAnchor(componentLocation, { isSuperseded: true })).toEqual({
      found: element,
      placement: "replace",
    });
  });

  it("should refuse a superseded component whose id now names another kind", () => {
    // A structural path the plan reused for something else. Replacing here
    // would hide a live component behind a record of a different one, so the
    // change belongs in the archive instead.
    articleHolding("wireframe");
    expect(liveLensAnchor(componentLocation, { isSuperseded: true })).toEqual({
      missing: "drifted-content",
    });
  });

  it("should not ask the question at all while the change set is current", () => {
    const element = articleHolding("wireframe");
    expect(liveLensAnchor(componentLocation, { isSuperseded: false })).toEqual({
      found: element,
      placement: "replace",
    });
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

describe("misses under a plan-DOM lag", () => {
  afterEach(() =>
    publishPlanSnapshots({ displayedSnapshot: "", currentSnapshot: "" }),
  );

  it("reports absence as absence while the article is current", () => {
    expect(isPlanDomBehind()).toBe(false);
    expect(pickLiveCandidate([])).toEqual({ missing: "unknown-id" });
  });

  it("says the article is behind rather than that the name is unknown", () => {
    publishPlanSnapshots({
      displayedSnapshot: "aaa",
      currentSnapshot: "bbb",
    });
    expect(isPlanDomBehind()).toBe(true);
    // The name is not absent from the plan; it is absent from an article that
    // a landed write has already made stale. A caller that renders absence
    // must wait, and this is the only thing that tells it to.
    expect(pickLiveCandidate([])).toEqual({ missing: "plan-dom-behind" });
  });

  it("goes back to plain absence once the article has caught up", () => {
    publishPlanSnapshots({
      displayedSnapshot: "aaa",
      currentSnapshot: "bbb",
    });
    publishPlanSnapshots({
      displayedSnapshot: "bbb",
      currentSnapshot: "bbb",
    });
    expect(isPlanDomBehind()).toBe(false);
    expect(pickLiveCandidate([])).toEqual({ missing: "unknown-id" });
  });
});
