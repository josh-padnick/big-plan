// Owns when a lens owes the reader a scroll.
//
// Most of what happens to a change does not move the reader: stepping between
// changes, a verdict landing, an article swap. One gesture does. Undo reopens a
// question, and a question the reader cannot see is not one they can answer, so
// the change has to come back to them wherever they had scrolled to.
//
// The rule is separate from the lens because the ask has to outlive the
// component. While a change is rejected the tour renders no lens at all, so the
// ask arrives at nothing, and the lens that will honour it does not exist until
// the article has caught up - by which point the plan refresh has restored the
// reader's old scroll position over the top of anything a mount had positioned.
// Tracking which reveal has been honoured, rather than which one a mount has
// seen, is what carries the ask across that gap; and honouring each one exactly
// once is what stops a lens from pulling the page back every time it re-renders.

/** The reveal the reader has already been taken to; nothing has asked yet. */
export const NO_REVEAL_HONOURED = 0;

/**
 * Whether this lens still owes the reader the scroll a reveal asked for.
 *
 * A lens with nowhere to stand owes nothing yet: the ask stays outstanding
 * until there is a host to honour it with, which is exactly the case undoing a
 * rejection creates.
 */
export const shouldHonourReveal = ({
  revealKey,
  honoured,
  hasHost,
}: {
  readonly revealKey: number;
  readonly honoured: number;
  readonly hasHost: boolean;
}): boolean => hasHost && revealKey > honoured;
