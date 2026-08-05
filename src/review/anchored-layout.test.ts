// Locks review-card collision layout to each surface's own document anchor.

import { describe, expect, it } from "vitest";
import { layoutAnchoredCards } from "./anchored-layout.js";

describe("anchored card layout", () => {
  it("should preserve document anchors when cards do not overlap", () => {
    expect(
      layoutAnchoredCards([
        { id: "one", anchorTop: 100, height: 40 },
        { id: "two", anchorTop: 200, height: 40 },
      ]),
    ).toEqual([
      { id: "one", top: 100 },
      { id: "two", top: 200 },
    ]);
  });

  it("should resolve a chain of overlapping cards in anchor order", () => {
    expect(
      layoutAnchoredCards([
        { id: "three", anchorTop: 120, height: 30 },
        { id: "one", anchorTop: 100, height: 50 },
        { id: "two", anchorTop: 110, height: 40 },
      ]),
    ).toEqual([
      { id: "one", top: 100 },
      { id: "two", top: 158 },
      { id: "three", top: 206 },
    ]);
  });

  it("should treat a compose as an ordinary entry between card anchors", () => {
    expect(
      layoutAnchoredCards([
        { id: "card-above", anchorTop: 80, height: 40 },
        { id: "compose", anchorTop: 180, height: 100 },
        { id: "card-below", anchorTop: 220, height: 40 },
      ]),
    ).toEqual([
      { id: "card-above", top: 80 },
      { id: "compose", top: 180 },
      { id: "card-below", top: 288 },
    ]);
  });

  it("should not move a card above an unrelated compose anchor", () => {
    const withoutCompose = layoutAnchoredCards([
      { id: "existing", anchorTop: 83, height: 80 },
    ]);
    const withCompose = layoutAnchoredCards([
      { id: "existing", anchorTop: 83, height: 80 },
      { id: "compose", anchorTop: 430, height: 225 },
    ]);
    expect(withCompose.find(({ id }) => id === "existing")).toEqual(
      withoutCompose[0],
    );
  });
});
