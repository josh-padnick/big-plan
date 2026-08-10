// Keeps contextual review threads readable when targets from different slides
// occupy the same part of the page.

export type ThreadPositionItem = {
  readonly id: string;
  readonly desiredTop: number;
  readonly height: number;
};

export type ThreadPosition = {
  readonly id: string;
  readonly top: number;
};

export const stackThreadPositions = ({
  items,
  gap,
}: {
  readonly items: ReadonlyArray<ThreadPositionItem>;
  readonly gap: number;
}): ReadonlyArray<ThreadPosition> => {
  const ordered = [...items].sort(
    (left, right) => left.desiredTop - right.desiredTop,
  );
  let previousBottom: number | null = null;

  return ordered.map((item) => {
    // One global stack prevents cards attached to separate anchors from
    // occupying the same page coordinates.
    const top =
      previousBottom === null
        ? item.desiredTop
        : Math.max(item.desiredTop, previousBottom + gap);
    previousBottom = top + item.height;
    return { id: item.id, top };
  });
};
