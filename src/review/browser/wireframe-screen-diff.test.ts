// Proves the normalized Wireframe screen comparison used by the browser
// Was/Now lens without coupling the decisions to DOM extraction or React.

import { describe, expect, it } from "vitest";
import {
  compareWireframeScreens,
  wireframeScreenIdForSide,
  wireframeScreenStatusLabel,
  type WireframeScreenSnapshot,
} from "./wireframe-screen-diff.js";

const screen = ({
  id,
  isCurrent = false,
  markup = id,
  name = id,
  position,
}: {
  readonly id: string;
  readonly isCurrent?: boolean;
  readonly markup?: string;
  readonly name?: string;
  readonly position: number;
}): WireframeScreenSnapshot => ({ id, isCurrent, markup, name, position });

const screenMap = (
  screens: ReadonlyArray<WireframeScreenSnapshot>,
): ReadonlyMap<string, WireframeScreenSnapshot> =>
  new Map(screens.map((snapshot) => [snapshot.id, snapshot]));

describe("compareWireframeScreens", () => {
  it("should expose an initial-screen transition before another changed screen", () => {
    const diffs = compareWireframeScreens({
      oldScreens: screenMap([
        screen({
          id: "queue",
          isCurrent: true,
          name: "Queue",
          position: 1,
        }),
        screen({ id: "detail", name: "Detail", position: 2 }),
        screen({ id: "audit", markup: "before", position: 3 }),
      ]),
      newScreens: screenMap([
        screen({ id: "queue", name: "Queue", position: 1 }),
        screen({
          id: "detail",
          isCurrent: true,
          name: "Detail",
          position: 2,
        }),
        screen({ id: "audit", markup: "after", position: 3 }),
      ]),
    });

    expect(diffs).toEqual([
      {
        key: "initial:queue:detail",
        name: "Queue → Detail",
        status: "initial",
        oldScreenId: "queue",
        newScreenId: "detail",
        oldPosition: 1,
        newPosition: 2,
      },
      {
        key: "screen:audit",
        name: "audit",
        status: "updated",
        oldScreenId: "audit",
        newScreenId: "audit",
        oldPosition: 3,
        newPosition: 3,
      },
    ]);
    const initial = diffs[0];
    if (initial === undefined) throw new Error("Expected an initial diff");
    expect(wireframeScreenIdForSide(initial, "old")).toBe("queue");
    expect(wireframeScreenIdForSide(initial, "new")).toBe("detail");
    expect(wireframeScreenStatusLabel(initial)).toBe("Initial screen");
  });

  it("should classify moved, added, and removed screens in document order", () => {
    const diffs = compareWireframeScreens({
      oldScreens: screenMap([
        screen({ id: "keep", isCurrent: true, position: 1 }),
        screen({ id: "removed", position: 2 }),
        screen({ id: "moved", position: 3 }),
      ]),
      newScreens: screenMap([
        screen({ id: "keep", isCurrent: true, position: 1 }),
        screen({ id: "moved", position: 2 }),
        screen({ id: "added", position: 3 }),
      ]),
    });

    expect(diffs.map(({ key, status }) => ({ key, status }))).toEqual([
      { key: "screen:moved", status: "moved" },
      { key: "screen:added", status: "added" },
      { key: "screen:removed", status: "removed" },
    ]);
    expect(diffs.map(wireframeScreenStatusLabel)).toEqual([
      "Moved 3 → 2",
      "Added at 3",
      "Removed from 2",
    ]);
  });
});
