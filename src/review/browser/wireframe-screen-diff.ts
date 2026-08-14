// Owns the pure comparison model for Wireframe screens shown by the Was/Now
// lens. DOM extraction and presentation effects stay at the browser view edge.

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

export type WireframeScreenSnapshot = {
  readonly id: string;
  readonly isCurrent: boolean;
  readonly markup: string;
  readonly name: string;
  readonly position: number;
};

/** Compares normalized screen snapshots in current-first document order. */
export const compareWireframeScreens = ({
  oldScreens,
  newScreens,
}: {
  readonly oldScreens: ReadonlyMap<string, WireframeScreenSnapshot>;
  readonly newScreens: ReadonlyMap<string, WireframeScreenSnapshot>;
}): ReadonlyArray<WireframeScreenDiff> => {
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
    const status =
      oldScreen.markup !== newScreen.markup
        ? "updated"
        : oldScreen.position !== newScreen.position
          ? "moved"
          : undefined;
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

/** Resolves the selected screen identity recorded by one snapshot side. */
export const wireframeScreenIdForSide = (
  screen: WireframeScreenDiff,
  side: "old" | "new",
): string | undefined => {
  if (side === "old") {
    return screen.status === "added" ? undefined : screen.oldScreenId;
  }
  return screen.status === "removed" ? undefined : screen.newScreenId;
};

/** Formats the positional meaning carried by a screen comparison. */
export const wireframeScreenStatusLabel = (
  screen: WireframeScreenDiff,
): string => {
  if (screen.status === "initial") return "Initial screen";
  if (screen.status === "added") {
    return `Added at ${screen.newPosition}`;
  }
  if (screen.status === "removed") {
    return `Removed from ${screen.oldPosition}`;
  }
  const moved = screen.oldPosition !== screen.newPosition;
  if (screen.status === "moved" && moved) {
    return `Moved ${screen.oldPosition} → ${screen.newPosition}`;
  }
  return moved
    ? `Updated · ${screen.oldPosition} → ${screen.newPosition}`
    : "Updated";
};
