// Owns Wireframe's model-level screen comparison. Detection, alignment, and
// block identity stay with the engine; this module only names how two
// compiled wireframes differ as screens: added, removed, moved, updated, or
// an initial-screen change.
//
// `updated` means the authored `WireframeScreen.children` trees differ, not
// that the rendered markup would. A name, device, url, or pattern change
// with identical children is therefore not `updated`. Position is the
// 1-based index in `screens` so status labels match the per-screen badges
// ("Added at 2", "Moved 4 to 3") the comparison has always shown.

import type { ComponentDiffInput } from "../_model/component-diff/contract.js";
import type {
  CompiledWireframe,
  WireframeNode,
  WireframeScreen,
} from "./model.js";

export type WireframeScreenDiff =
  | {
      readonly key: string;
      readonly name: string;
      readonly status: "added";
      readonly newScreenId: string;
      readonly newPosition: number;
    }
  | {
      readonly key: string;
      readonly name: string;
      readonly status: "initial";
      readonly oldScreenId: string;
      readonly newScreenId: string;
      readonly oldPosition: number;
      readonly newPosition: number;
    }
  | {
      readonly key: string;
      readonly name: string;
      readonly status: "moved" | "updated";
      readonly oldScreenId: string;
      readonly newScreenId: string;
      readonly oldPosition: number;
      readonly newPosition: number;
    }
  | {
      readonly key: string;
      readonly name: string;
      readonly status: "removed";
      readonly oldScreenId: string;
      readonly oldPosition: number;
    };

export type CompiledWireframeDiff =
  | {
      readonly status: "added";
      readonly proposed: CompiledWireframe;
      readonly screens: ReadonlyArray<WireframeScreenDiff>;
    }
  | {
      readonly status: "removed";
      readonly baseline: CompiledWireframe;
      readonly screens: ReadonlyArray<WireframeScreenDiff>;
    }
  | {
      readonly status: "changed";
      readonly baseline: CompiledWireframe;
      readonly proposed: CompiledWireframe;
      readonly screens: ReadonlyArray<WireframeScreenDiff>;
    };

type ScreenSnapshot = {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly isCurrent: boolean;
  readonly children: ReadonlyArray<WireframeNode>;
};

// Authored screen children are plain JSON-shaped trees from the compiler.
// Stringifying them is the deep comparison: key order is compiler-stable,
// and this is the rule `updated` now names, replacing markup-string equality.
const sameAuthoredChildren = (
  left: ReadonlyArray<WireframeNode>,
  right: ReadonlyArray<WireframeNode>,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const snapshotsFrom = (
  wireframe: CompiledWireframe,
): ReadonlyMap<string, ScreenSnapshot> =>
  new Map(
    wireframe.screens.map((screen: WireframeScreen, index) => [
      screen.id,
      {
        id: screen.id,
        name: screen.name,
        // Status labels are 1-based because they are read as positions in
        // the authored list, not as programming indexes.
        position: index + 1,
        isCurrent: screen.id === wireframe.initialScreenId,
        children: screen.children,
      },
    ]),
  );

/** Compares two compiled wireframes in proposed-first document order. */
export const compareWireframeScreens = ({
  baseline,
  proposed,
}: {
  readonly baseline?: CompiledWireframe;
  readonly proposed?: CompiledWireframe;
}): ReadonlyArray<WireframeScreenDiff> => {
  const oldScreens =
    baseline === undefined
      ? new Map<string, ScreenSnapshot>()
      : snapshotsFrom(baseline);
  const newScreens =
    proposed === undefined
      ? new Map<string, ScreenSnapshot>()
      : snapshotsFrom(proposed);
  const oldCurrent = [...oldScreens.values()].find(
    (screen) => screen.isCurrent,
  );
  const newCurrent = [...newScreens.values()].find(
    (screen) => screen.isCurrent,
  );
  const initialScreenDiffs: ReadonlyArray<WireframeScreenDiff> =
    oldCurrent !== undefined &&
    newCurrent !== undefined &&
    oldCurrent.id !== newCurrent.id
      ? [
          {
            key: `initial:${oldCurrent.id}:${newCurrent.id}`,
            name: `${oldCurrent.name} → ${newCurrent.name}`,
            status: "initial",
            oldScreenId: oldCurrent.id,
            newScreenId: newCurrent.id,
            oldPosition: oldCurrent.position,
            newPosition: newCurrent.position,
          },
        ]
      : [];
  const ids = [...new Set([...newScreens.keys(), ...oldScreens.keys()])];
  const contentDiffs = ids.flatMap<WireframeScreenDiff>((id) => {
    const oldScreen = oldScreens.get(id);
    const newScreen = newScreens.get(id);
    if (oldScreen === undefined && newScreen !== undefined) {
      return [
        {
          key: `screen:${id}`,
          name: newScreen.name,
          status: "added",
          newScreenId: id,
          newPosition: newScreen.position,
        },
      ];
    }
    if (newScreen === undefined && oldScreen !== undefined) {
      return [
        {
          key: `screen:${id}`,
          name: oldScreen.name,
          status: "removed",
          oldScreenId: id,
          oldPosition: oldScreen.position,
        },
      ];
    }
    if (oldScreen === undefined || newScreen === undefined) return [];
    const status = sameAuthoredChildren(oldScreen.children, newScreen.children)
      ? oldScreen.position !== newScreen.position
        ? "moved"
        : undefined
      : "updated";
    return status === undefined
      ? []
      : [
          {
            key: `screen:${id}`,
            name: newScreen.name,
            status,
            oldScreenId: id,
            newScreenId: id,
            oldPosition: oldScreen.position,
            newPosition: newScreen.position,
          },
        ];
  });
  return [...initialScreenDiffs, ...contentDiffs];
};

/** Derives the wireframe's screen-level diff from the engine's model pair. */
export const compileWireframeDiff = (
  input: ComponentDiffInput<CompiledWireframe>,
): CompiledWireframeDiff => {
  if (input.status === "added") {
    return {
      status: "added",
      proposed: input.proposed,
      screens: compareWireframeScreens({ proposed: input.proposed }),
    };
  }
  if (input.status === "removed") {
    return {
      status: "removed",
      baseline: input.baseline,
      screens: compareWireframeScreens({ baseline: input.baseline }),
    };
  }
  return {
    status: "changed",
    baseline: input.baseline,
    proposed: input.proposed,
    screens: compareWireframeScreens({
      baseline: input.baseline,
      proposed: input.proposed,
    }),
  };
};

/** Formats the positional meaning carried by a screen comparison. */
export const wireframeScreenStatusLabel = (
  screen: WireframeScreenDiff,
): string => {
  if (screen.status === "initial") return "Initial screen";
  if (screen.status === "added") {
    return `Added at ${String(screen.newPosition)}`;
  }
  if (screen.status === "removed") {
    return `Removed from ${String(screen.oldPosition)}`;
  }
  const moved = screen.oldPosition !== screen.newPosition;
  if (screen.status === "moved" && moved) {
    return `Moved ${String(screen.oldPosition)} → ${String(screen.newPosition)}`;
  }
  return moved
    ? `Updated · ${String(screen.oldPosition)} → ${String(screen.newPosition)}`
    : "Updated";
};
