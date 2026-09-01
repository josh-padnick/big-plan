// Decides where the page should sit when the tour opens a change.
//
// A change is two readings the reviewer compares - what the plan said and what
// it says now - and comparing them means holding both on screen at once.
// Centring the card does neither job: a short change floats in the middle with
// the plan's own context pushed off both edges, and a tall one is centred on
// its own middle, so the reader arrives looking at neither end of it.
//
// The rule is therefore about the ends, not the middle. A change that fits is
// pulled down until it finishes just above the stepper, which is the lowest
// line the reader can read and the control they act on next. A change too tall
// to fit is opened at its beginning instead, because the beginning is where
// reading it starts and no scroll position can show all of it.

/** The room a change has, and where the change sits in the document. */
export type DiffScrollFrame = {
  /** The change's top edge, in document space. */
  readonly cardTop: number;
  readonly cardHeight: number;
  /** The first line clear of the sticky header, in viewport space. */
  readonly readingTop: number;
  /**
   * The stepper's top edge in viewport space, or the viewport height when no
   * stepper is showing - a change opened from a thread has the same shape of
   * question without a bar under it.
   */
  readonly floorTop: number;
  /** How much of the document can be scrolled past. */
  readonly maxScroll: number;
};

/**
 * The breathing room kept between the change and whatever bounds it. One step
 * of the spacing scale: enough that the card is not touching the stepper or
 * the header, small enough that it does not read as a gap.
 */
export const DIFF_SCROLL_GAP = 16;

/** Where the page should scroll to open one change. */
export const diffScrollTarget = ({
  cardTop,
  cardHeight,
  readingTop,
  floorTop,
  maxScroll,
}: DiffScrollFrame): number => {
  const room = floorTop - readingTop - DIFF_SCROLL_GAP * 2;
  // Landing the top at the top is both the answer for a change too tall to fit
  // and the honest fallback when the stepper leaves no room to reason about.
  const openAtTop = cardTop - readingTop - DIFF_SCROLL_GAP;
  const target =
    room > 0 && cardHeight <= room
      ? cardTop + cardHeight - floorTop + DIFF_SCROLL_GAP
      : openAtTop;
  return Math.max(0, Math.min(target, maxScroll));
};
