// Proves an overflow menu opens where a reader can reach it, including at the
// bottom edge of the viewport its bar is pinned to.

import { describe, expect, it } from "vitest";
import {
  MENU_GAP,
  MENU_MARGIN,
  placeOverflowMenu,
} from "./overflow-menu-position.js";

const viewport = { width: 1_000, height: 800 };
const anchor = { top: 700, left: 600, width: 24, height: 24 };

describe("placeOverflowMenu", () => {
  it("opens above its trigger and hangs from its right edge", () => {
    const position = placeOverflowMenu({
      anchor,
      menu: { width: 200, height: 120 },
      viewport,
    });
    expect(position).toEqual({
      side: "above",
      top: 700 - MENU_GAP - 120,
      left: 600 + 24 - 200,
    });
  });

  it("flips below when the trigger sits against the top edge", () => {
    const position = placeOverflowMenu({
      anchor: { ...anchor, top: 10 },
      menu: { width: 200, height: 120 },
      viewport,
    });
    expect(position.side).toBe("below");
    expect(position.top).toBe(10 + 24 + MENU_GAP);
  });

  it("keeps a panel taller than the room it has on screen", () => {
    const position = placeOverflowMenu({
      anchor: { ...anchor, top: 40 },
      menu: { width: 200, height: 900 },
      viewport,
    });
    expect(position.top).toBe(MENU_MARGIN);
  });

  it("clamps a panel wider than the room to its right", () => {
    const position = placeOverflowMenu({
      anchor: { ...anchor, left: 20 },
      menu: { width: 400, height: 100 },
      viewport,
    });
    expect(position.left).toBe(MENU_MARGIN);
  });

  it("keeps a panel inside the right edge when the trigger is at it", () => {
    const position = placeOverflowMenu({
      anchor: { ...anchor, left: 980 },
      menu: { width: 200, height: 100 },
      viewport,
    });
    expect(position.left).toBe(1_000 - MENU_MARGIN - 200);
  });
});
