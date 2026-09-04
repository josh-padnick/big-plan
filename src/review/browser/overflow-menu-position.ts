// Owns where an overflow menu's panel goes once the browser has measured its
// trigger and itself.
//
// The rule is pure and lives apart from the component for the reason every
// other placement rule in this island does: a panel that lands off-screen is a
// silent failure - the control opened, nothing is visible, and nothing throws.
// Stating the geometry once, and proving it, is what keeps the menu reachable
// at the bottom edge of a viewport where the bar it belongs to always sits.

/** How far the panel stands off its trigger, and off the viewport edge. */
export const MENU_GAP = 6;
export const MENU_MARGIN = 8;

export type MenuRect = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

export type MenuViewport = {
  readonly width: number;
  readonly height: number;
};

export type MenuPosition = {
  readonly top: number;
  readonly left: number;
  /** Which side of the trigger the panel took, so the caller can say so. */
  readonly side: "above" | "below";
};

/**
 * Places a menu panel over its trigger.
 *
 * Above is preferred because the control this exists for sits in a bar pinned
 * to the bottom of the viewport, where below is off-screen. The panel flips
 * only when above genuinely does not fit, and is clamped either way so a panel
 * taller than the room it has still starts somewhere a reader can see.
 */
export const placeOverflowMenu = ({
  anchor,
  menu,
  viewport,
}: {
  readonly anchor: MenuRect;
  readonly menu: { readonly width: number; readonly height: number };
  readonly viewport: MenuViewport;
}): MenuPosition => {
  const roomAbove = anchor.top - MENU_MARGIN;
  const roomBelow =
    viewport.height - (anchor.top + anchor.height) - MENU_MARGIN;
  const fitsAbove = menu.height + MENU_GAP <= roomAbove;
  const side: "above" | "below" =
    fitsAbove || roomAbove >= roomBelow ? "above" : "below";
  const rawTop =
    side === "above"
      ? anchor.top - MENU_GAP - menu.height
      : anchor.top + anchor.height + MENU_GAP;
  const maxTop = Math.max(
    MENU_MARGIN,
    viewport.height - MENU_MARGIN - menu.height,
  );
  const top = Math.min(Math.max(MENU_MARGIN, rawTop), maxTop);
  // The panel hangs from the trigger's right edge, because the trigger is the
  // rightmost control in its row and a left-aligned panel would grow off the
  // side of the screen the row already ends at.
  const rawLeft = anchor.left + anchor.width - menu.width;
  const maxLeft = Math.max(
    MENU_MARGIN,
    viewport.width - MENU_MARGIN - menu.width,
  );
  const left = Math.min(Math.max(MENU_MARGIN, rawLeft), maxLeft);
  return { top, left, side };
};
