// Owns viewport-aware placement for an alert that hangs from a control
// instead of sitting in the middle of the page.

const DEFAULT_GAP = 4;
const DEFAULT_INSET = 12;

export type AnchoredDialogPosition = {
  readonly top: number;
  readonly right: number;
  readonly maxHeight: number;
  readonly maxWidth: number;
};

/**
 * Places a panel below its control, right-aligned to that control, and
 * clamped so it never leaves the viewport.
 */
export const placeAnchoredDialog = ({
  anchor,
  viewport,
  preferredWidth,
  gap = DEFAULT_GAP,
  inset = DEFAULT_INSET,
}: {
  readonly anchor: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly viewport: {
    readonly width: number;
    readonly height: number;
  };
  readonly preferredWidth: number;
  readonly gap?: number;
  readonly inset?: number;
}): AnchoredDialogPosition => {
  const top = Math.max(inset, anchor.bottom + gap);
  const right = Math.max(inset, viewport.width - anchor.right);
  const maxWidth = Math.max(
    0,
    Math.min(preferredWidth, viewport.width - right - inset),
  );
  const maxHeight = Math.max(0, viewport.height - top - inset);
  return { top, right, maxHeight, maxWidth };
};
