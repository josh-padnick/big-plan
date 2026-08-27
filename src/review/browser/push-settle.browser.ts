// Owns the one-shot settle a pushed revision leaves on the blocks it changed.
//
// The reader was reading when the plan changed underneath them. The swap
// itself is silent by design - it preserves scroll, threads, and composer text
// - which is exactly why it needs a mark: without one, the only evidence that
// anything moved is that the words are different from the ones the reader
// remembers. The settle is deliberately brief and non-blocking; it says "these
// blocks are the new ones" and then gets out of the way.
//
// Two rules keep it honest. A reader who asked for less motion gets none: the
// mark is skipped outright rather than shortened, because a flash is the whole
// effect. And a block the resolver reports as unlaid-out - inside a collapsed
// slide - is skipped rather than measured, since painting an animation on a
// box the browser never laid out is invisible work whose absence is
// indistinguishable from success.

import { liveVisibleBlock } from "./live-target.browser.js";

/**
 * Marks a block as freshly arrived. An attribute rather than a class because
 * this styles server-owned plan markup the island did not render, which is the
 * boundary the review stylesheet exists for.
 */
export const SETTLE_ATTRIBUTE = "data-review-settled";

/** Whether the reader has asked the viewer to keep motion to a minimum. */
export const prefersReducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Applies the settle to every changed block the reader can currently see, and
 * reports how many took it. Returns zero, never throws, when there is nothing
 * to mark or the reader asked for no motion.
 */
export const settleChangedBlocks = (
  blockIds: ReadonlyArray<string>,
): number => {
  if (blockIds.length === 0 || prefersReducedMotion()) return 0;
  let settled = 0;
  for (const blockId of blockIds) {
    const target = liveVisibleBlock(blockId);
    if ("missing" in target) continue;
    const element = target.found;
    // A second push landing on the same block would otherwise inherit the
    // running animation and show nothing. Clearing the attribute and forcing
    // the pending style change to flush restarts it.
    element.removeAttribute(SETTLE_ATTRIBUTE);
    void element.offsetWidth;
    element.setAttribute(SETTLE_ATTRIBUTE, "");
    // `animationend` bubbles, so any animation finishing beneath this block -
    // including a nested block the same revision settled - would otherwise
    // clear a wash that has not run yet.
    const clear = (event: AnimationEvent) => {
      if (event.target !== element) return;
      element.removeEventListener("animationend", clear);
      element.removeAttribute(SETTLE_ATTRIBUTE);
    };
    element.addEventListener("animationend", clear);
    settled += 1;
  }
  return settled;
};
