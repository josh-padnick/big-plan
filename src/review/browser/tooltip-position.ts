// Owns viewport-aware placement for portaled review tooltips.

const TOOLTIP_GAP = 8;
const VIEWPORT_INSET = 8;
const TOOLTIP_MIN_READABLE_HEIGHT = 2 * 16;

export type TooltipPosition = {
  readonly top: number;
  readonly left: number;
  readonly placement: "above" | "below";
  readonly maxHeight: number;
};

/** Places a tooltip on the roomier side and bounds it to that viewport slot. */
export const placeTooltip = ({
  anchor,
  viewport,
  preferredPlacement,
  maxWidth,
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
  readonly preferredPlacement?: "above" | "below";
  readonly maxWidth: number;
}): TooltipPosition => {
  const roomAbove = Math.max(0, anchor.top - TOOLTIP_GAP - VIEWPORT_INSET);
  const roomBelow = Math.max(
    0,
    viewport.height - anchor.bottom - TOOLTIP_GAP - VIEWPORT_INSET,
  );
  const roomierPlacement = roomAbove >= roomBelow ? "above" : "below";
  const preferredRoom = preferredPlacement === "above" ? roomAbove : roomBelow;
  const placement =
    preferredPlacement === undefined ||
    (preferredRoom < TOOLTIP_MIN_READABLE_HEIGHT &&
      (preferredPlacement === "above" ? roomBelow : roomAbove) > preferredRoom)
      ? roomierPlacement
      : preferredPlacement;
  const center = anchor.left + (anchor.right - anchor.left) / 2;
  // The caller owns the tooltip's widest measure, because the clamp has to
  // match the width the tooltip actually renders at: a narrow clamp against a
  // wide tooltip lets its far edge run off the viewport with nothing to say so.
  const horizontalEdge = Math.min(
    maxWidth / 2 + VIEWPORT_INSET,
    viewport.width / 2,
  );
  return {
    top:
      placement === "above"
        ? anchor.top - TOOLTIP_GAP
        : anchor.bottom + TOOLTIP_GAP,
    left: Math.min(
      viewport.width - horizontalEdge,
      Math.max(horizontalEdge, center),
    ),
    placement,
    maxHeight: placement === "above" ? roomAbove : roomBelow,
  };
};
