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

/**
 * The nearest laid-out element among a node's siblings, searched outwards from
 * the node in both directions at once.
 *
 * Content that replaces a block in place takes the block's slot in its parent
 * rather than wrapping it, so a sibling is where the replacement is, and the
 * nearest one is the closest thing to the place the block had. Nothing here
 * knows what did the replacing, which is the point: every way of standing in
 * for a block puts something in that slot, and a search for a box finds them
 * all without being told about any of them.
 */
const renderedSibling = (node: HTMLElement): HTMLElement | null => {
  let before = node.previousElementSibling;
  let after = node.nextElementSibling;
  while (before !== null || after !== null) {
    if (before instanceof HTMLElement && isRendered(before)) return before;
    if (after instanceof HTMLElement && isRendered(after)) return after;
    before = before?.previousElementSibling ?? null;
    after = after?.nextElementSibling ?? null;
  }
  return null;
};

/**
 * Whether the element's own place on the page is still laid out - by the
 * element itself, or by whatever took its slot beside it.
 *
 * A thread remembers how far its target sat below its card so that a lens
 * re-rendering the block in place cannot drag the thread off the words it
 * points at, and that remembered distance stays true only while the slot it
 * was measured to is still occupied. A lens leaves the slot occupied: the
 * block loses its box and the lens takes its place beside it. A collapse
 * empties the whole card body, so nothing in the slot has a box and the
 * distance names a gap that has closed.
 *
 * The search deliberately stops at the target's own siblings. Climbing would
 * find the card's own header - which a collapsed card keeps, laid out and
 * often tall enough to swallow the remembered distance - and call the closed
 * gap occupied.
 */
export const holdsItsPlace = (element: HTMLElement): boolean =>
  isRendered(element) || renderedSibling(element) !== null;

/**
 * The element that shows the reader where this one's content is: the element
 * itself while it has a box, otherwise whatever now occupies its place, and
 * failing that the nearest ancestor with a box.
 *
 * The order is what makes the answer useful. A lens hides the block and puts
 * its own rendering in the slot beside it, so the sibling is the content the
 * reader came to see, while the nearest ancestor of a top-level block is the
 * whole article - an answer that contains the block and tells the reader
 * nothing about where it is. A collapse takes the slot away with everything
 * else in the card, and the ancestor that is left is then the honest answer,
 * because the card is genuinely where that content now lives.
 */
export const renderedStandIn = (element: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = element;
  while (node !== null) {
    if (isRendered(node)) return node;
    const sibling = renderedSibling(node);
    if (sibling !== null) return sibling;
    node = node.parentElement;
  }
  return null;
};

/**
 * Sends the reader to an element, or to whatever stands in for it when the
 * element itself has no box. Scrolling to an unlaid-out element moves the page
 * nowhere, which reads as a control that did nothing at all.
 */
export const scrollToLiveElement = (
  element: HTMLElement,
  block: ScrollLogicalPosition,
): void => {
  (renderedStandIn(element) ?? element).scrollIntoView({
    behavior: "smooth",
    block,
  });
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
      right: rect.right + scrollX,
      top: rect.top + scrollY,
    },
  };
};
