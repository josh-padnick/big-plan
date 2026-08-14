// Owns viewport-aware placement for portaled review tooltips.

const TOOLTIP_GAP = 8;
const VIEWPORT_INSET = 8;
const TOOLTIP_MAX_WIDTH = 11 * 16;

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
}): TooltipPosition => {
  const roomAbove = Math.max(0, anchor.top - TOOLTIP_GAP - VIEWPORT_INSET);
  const roomBelow = Math.max(
    0,
    viewport.height - anchor.bottom - TOOLTIP_GAP - VIEWPORT_INSET,
  );
  const placement =
    preferredPlacement ?? (roomAbove >= roomBelow ? "above" : "below");
  const center = anchor.left + (anchor.right - anchor.left) / 2;
  const horizontalEdge = Math.min(
    TOOLTIP_MAX_WIDTH / 2 + VIEWPORT_INSET,
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
