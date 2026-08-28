// Proves Wireframe's model-level screen comparison: added, removed, moved,
// updated, and initial-screen changes, including the rule the markup
// comparison could not state — `updated` means authored children differ.

import { describe, expect, it } from "vitest";
import {
  compareWireframeScreens,
  compileWireframeDiff,
  wireframeScreenStatusLabel,
} from "./compile-diff.js";
import type {
  CompiledWireframe,
  WireframeNode,
  WireframeScreen,
} from "./model.js";

const text = (value: string): WireframeNode => ({
  element: "Text",
  text: value,
  role: "body",
});

const screen = ({
  id,
  name = id,
  children,
}: {
  readonly id: string;
  readonly name?: string;
  readonly children?: ReadonlyArray<WireframeNode>;
}): WireframeScreen => ({
  id,
  name,
  device: "desktop",
  children: children ?? [text(id)],
});

const wireframe = ({
  id = "wf",
  initialScreenId,
  screens,
}: {
  readonly id?: string;
  readonly initialScreenId?: string;
  readonly screens: ReadonlyArray<WireframeScreen>;
}): CompiledWireframe => ({
  id,
  initialScreenId: initialScreenId ?? screens[0]?.id ?? "",
  screens,
});

describe("compareWireframeScreens", () => {
  it("should expose an initial-screen transition before another changed screen", () => {
    const diffs = compareWireframeScreens({
      baseline: wireframe({
        initialScreenId: "queue",
        screens: [
          screen({ id: "queue", name: "Queue" }),
          screen({ id: "detail", name: "Detail" }),
          screen({ id: "audit", children: [text("before")] }),
        ],
      }),
      proposed: wireframe({
        initialScreenId: "detail",
        screens: [
          screen({ id: "queue", name: "Queue" }),
          screen({ id: "detail", name: "Detail" }),
          screen({ id: "audit", children: [text("after")] }),
        ],
      }),
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
    expect(wireframeScreenStatusLabel(initial)).toBe("Initial screen");
  });

  it("should classify moved, added, and removed screens in document order", () => {
    const diffs = compareWireframeScreens({
      baseline: wireframe({
        initialScreenId: "keep",
        screens: [
          screen({ id: "keep" }),
          screen({ id: "removed" }),
          screen({ id: "moved" }),
        ],
      }),
      proposed: wireframe({
        initialScreenId: "keep",
        screens: [
          screen({ id: "keep" }),
          screen({ id: "moved" }),
          screen({ id: "added" }),
        ],
      }),
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

  it("should not mark a screen updated when only its name changes, because updated means authored children differ, not rendered markup", () => {
    const children = [text("same content")];
    const diffs = compareWireframeScreens({
      baseline: wireframe({
        screens: [screen({ id: "home", name: "Home", children })],
      }),
      proposed: wireframe({
        screens: [screen({ id: "home", name: "Overview", children })],
      }),
    });

    expect(diffs).toEqual([]);
  });

  it("should mark a screen updated when authored children differ at the same position", () => {
    const diffs = compareWireframeScreens({
      baseline: wireframe({
        screens: [
          screen({ id: "home", name: "Home", children: [text("before")] }),
        ],
      }),
      proposed: wireframe({
        screens: [
          screen({ id: "home", name: "Home", children: [text("after")] }),
        ],
      }),
    });

    expect(diffs).toEqual([
      {
        key: "screen:home",
        name: "Home",
        status: "updated",
        oldScreenId: "home",
        newScreenId: "home",
        oldPosition: 1,
        newPosition: 1,
      },
    ]);
    const updated = diffs[0];
    if (updated === undefined) throw new Error("Expected an updated diff");
    expect(wireframeScreenStatusLabel(updated)).toBe("Updated");
  });
});

describe("compileWireframeDiff", () => {
  it("should treat every proposed screen as added when the wireframe itself is added", () => {
    const proposed = wireframe({
      screens: [screen({ id: "only", name: "Only" })],
    });
    const compiled = compileWireframeDiff({
      status: "added",
      proposed,
      runs: [],
    });

    expect(compiled.status).toBe("added");
    expect(compiled.screens).toEqual([
      {
        key: "screen:only",
        name: "Only",
        status: "added",
        newScreenId: "only",
        newPosition: 1,
      },
    ]);
  });
});
