// Verifies collision-free vertical placement for contextual review threads.

import { describe, expect, it } from "vitest";
import { stackThreadPositions } from "./thread-layout.js";

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
