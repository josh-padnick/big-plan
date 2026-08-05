// Owns collision layout for review chrome anchored in document coordinates.
// DOM measurement stays in the browser adapter; this module only decides tops.

export const ANCHORED_CARD_GAP = 8;

export type AnchoredCardEntry = {
  readonly id: string;
  readonly anchorTop: number;
  readonly height: number;
};

export type AnchoredCardPosition = {
  readonly id: string;
  readonly top: number;
};

/** Places anchor-sorted cards without allowing a preceding card to overlap. */
export const layoutAnchoredCards = (
  entries: ReadonlyArray<AnchoredCardEntry>,
): ReadonlyArray<AnchoredCardPosition> => {
  let previousBottom = Number.NEGATIVE_INFINITY;
  return [...entries]
    .sort(
      (left, right) =>
        left.anchorTop - right.anchorTop || left.id.localeCompare(right.id),
    )
    .map((entry) => {
      const top = Math.max(entry.anchorTop, previousBottom + ANCHORED_CARD_GAP);
      previousBottom = top + entry.height;
      return { id: entry.id, top };
    });
};
