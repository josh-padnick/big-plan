// Verifies collision-free vertical placement for contextual review threads,
// and that horizontal placement keeps a thread beside its anchor on the right.

import { describe, expect, it } from "vitest";
import { stackThreadPositions, threadLeft } from "./thread-layout.js";

describe("stackThreadPositions", () => {
  it("should stack threads globally when comments from different targets overlap", () => {
    expect(
      stackThreadPositions({
        gap: 8,
        items: [
          { id: "overview", desiredTop: 120, height: 180 },
          { id: "slide-one", desiredTop: 260, height: 220 },
          { id: "slide-two", desiredTop: 410, height: 140 },
        ],
      }),
    ).toEqual([
      { id: "overview", top: 120 },
      { id: "slide-one", top: 308 },
      { id: "slide-two", top: 536 },
    ]);
  });

  it("should preserve target order rather than comment creation order", () => {
    expect(
      stackThreadPositions({
        gap: 8,
        items: [
          { id: "lower", desiredTop: 500, height: 100 },
          { id: "upper", desiredTop: 100, height: 100 },
        ],
      }),
    ).toEqual([
      { id: "upper", top: 100 },
      { id: "lower", top: 500 },
    ]);
  });
});

describe("threadLeft", () => {
  // A wide reading screen with the anchor card ending well short of the edge.
  const wide = {
    anchorRight: 1443,
    anchorOffset: -12,
    threadWidth: 272,
    viewportWidth: 1911,
    sidebarWidth: 0,
    scrollX: 0,
    pageMargin: 24,
  };

  it("should sit at the anchor's right edge when the viewport has room", () => {
    expect(threadLeft(wide)).toBe(1431);
  });

  it("should stop short of the open sidebar rather than sit under it", () => {
    expect(threadLeft({ ...wide, anchorRight: 1600, sidebarWidth: 352 })).toBe(
      1911 - 352 - 272 - 24,
    );
  });

  it("should follow the anchor when the page is scrolled sideways", () => {
    expect(threadLeft({ ...wide, anchorRight: 1443 + 300, scrollX: 300 })).toBe(
      1731,
    );
  });

  /*
  BIG-188: a thread rendered in the left margin of a wide screen was the whole
  reported bug, and the only way this function can produce that is a viewport
  with no room to the right of the anchor. Pinning both states keeps the left
  margin readable as "nowhere left to go" rather than as a placement the caller
  can reach by handing over an anchor it never measured.
  */
  it("should keep a right-hand anchor on the right in both sidebar states", () => {
    for (const sidebarWidth of [0, 352]) {
      expect(threadLeft({ ...wide, sidebarWidth })).toBeGreaterThan(
        wide.viewportWidth / 2,
      );
    }
  });

  it("should fall back to the page margin only when nothing else fits", () => {
    expect(threadLeft({ ...wide, viewportWidth: 300, anchorRight: 260 })).toBe(
      24,
    );
  });
});
