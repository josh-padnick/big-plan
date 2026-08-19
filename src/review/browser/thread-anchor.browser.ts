// Owns the one geometry question the floating comment threads ask of plan DOM:
// which rect does this thread position against?
//
// live-target.browser.ts answers the identity question, and it deliberately
// answers with elements that are not on screen - a block inside a collapsed
// slide is the right element for containment, labelling, and existence. That
// answer is the wrong thing to draw a card beside, and the wrongness is
// silent: an element the browser never laid out still answers
// getBoundingClientRect(), with an all-zero rect indistinguishable from a real
// measurement at the document origin. A thread positioned from that rect
// clamps to the page's left margin, the far side of the screen from the
// content it belongs to.
//
// So identity becomes geometry in exactly one place, and that place never
// fabricates a rect. It answers with a rect it measured and the element it
// measured, or with the reason it has none, in the same shape live-target uses
// for the same reason.
//
// A remembered rect is deliberately not part of the answer. Page coordinates
// only describe the layout they were taken from, and whatever hid an anchor -
// a collapse, a lens, a theme swap - is usually the same thing that reflowed
// everything around it, so the remembered rect names a place nothing occupies.

/** Why a thread anchor could not be measured. */
export type ThreadAnchorMissReason =
  // Neither the anchor nor any ancestor of it is laid out, which happens only
  // while the element is detached from the document.
  "not-rendered";

/** An anchor rect in page coordinates, measured from a laid-out element. */
export type MeasuredThreadAnchor = {
  readonly left: number;
  readonly right: number;
  readonly top: number;
};

export type ThreadAnchorResult =
  | {
      readonly measured: MeasuredThreadAnchor;
      /** The element the rect came from, which may be an ancestor of the anchor. */
      readonly element: HTMLElement;
    }
  | { readonly missing: ThreadAnchorMissReason };

/** Whether the browser gave this element a box on the page. */
export const isRendered = (element: Element): boolean =>
  element.getClientRects().length > 0;

/**
 * The nearest element up the tree that the browser actually laid out.
 *
 * A collapsed slide keeps its header on the page, so an anchor inside the
 * collapsed body still has a visible stand-in the reader can see. Walking up
 * to it keeps the thread beside the row that now represents its content
 * instead of stranding the thread where nothing is.
 */
export const renderedAncestor = (element: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = element;
  while (node !== null) {
    if (isRendered(node)) return node;
    node = node.parentElement;
  }
  return null;
};

/** Measures the rect a thread anchored to this element should sit beside. */
export const measureThreadAnchor = (
  element: HTMLElement,
  { scrollX, scrollY }: { readonly scrollX: number; readonly scrollY: number },
): ThreadAnchorResult => {
  const rendered = renderedAncestor(element);
  if (rendered === null) return { missing: "not-rendered" };
  const rect = rendered.getBoundingClientRect();
  return {
    element: rendered,
    measured: {
      left: rect.left + scrollX,
      right: rect.right + scrollX,
      top: rect.top + scrollY,
    },
  };
};
