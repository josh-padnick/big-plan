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

/**
 * Where a thread's left edge goes for one anchor, in page coordinates.
 *
 * A thread belongs beside its anchor's right edge, and the only thing allowed
 * to move it is the far side of the viewport: it may not run under the open
 * sidebar, and it may not run off the page. Both bounds are read as ceilings
 * on how far right the card may start, so the result never lands left of the
 * anchor unless the viewport genuinely has no room to its right.
 *
 * The page margin is a floor rather than a placement: reaching it means the
 * card had nowhere to go, and a caller that reaches it for an anchor sitting
 * in the middle of a wide screen has measured something that is not on screen.
 */
export const threadLeft = ({
  anchorRight,
  anchorOffset,
  threadWidth,
  viewportWidth,
  sidebarWidth,
  scrollX,
  pageMargin,
}: {
  readonly anchorRight: number;
  readonly anchorOffset: number;
  readonly threadWidth: number;
  readonly viewportWidth: number;
  readonly sidebarWidth: number;
  readonly scrollX: number;
  readonly pageMargin: number;
}): number => {
  const rightmost =
    scrollX + viewportWidth - sidebarWidth - threadWidth - pageMargin;
  return Math.max(
    scrollX + pageMargin,
    Math.min(anchorRight + anchorOffset, rightmost),
  );
};
