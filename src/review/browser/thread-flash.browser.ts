// Takes the reviewer to one thread and marks it when they arrive.
//
// The drawer narrows a thread to the change it is about, so part of the
// conversation is deliberately not on screen. Telling the reviewer that the
// rest exists is only half an answer: a link that says so has to land them on
// it, and landing is not the same as scrolling - a page of similar-looking
// cards, arrived at without being told which one, reads as having gone
// nowhere.
//
// What gets marked is the whole thread window. A mark on one message inside it
// picks out something the reviewer did not ask for - they asked where the rest
// of this conversation is, and the answer is the conversation, not a line of
// it.
//
// A thread is drawn in two places at once, beside the plan and in the feedback
// rail, so the ask names which of them it means. Marking both would be two
// answers to one question, and marking the wrong one is no answer at all.
//
// The ask is held for as long as the mark lasts rather than consumed by the
// first thread that sees it, because getting there opens panels and rebuilds
// the thread, and the copy that claimed the ask is usually unmounted a tick
// later.

import { useEffect, useState } from "react";
import type { ThreadSurface } from "../shared/thread-open-state.js";

/**
 * How long the mark stays up.
 *
 * Long enough that a reader who clicked, waited for the panel to open, and
 * then looked, still finds it - and short enough that it never becomes part of
 * how the thread looks.
 */
const FLASH_MS = 2_400;

type FlashTarget = {
  readonly commentId: string;
  readonly surface: ThreadSurface;
};

/** The thread being pointed at, while it is being pointed at. */
let target: FlashTarget | null = null;
let clearTimer: number | null = null;
const listeners = new Set<() => void>();

const announce = (): void => {
  for (const listener of [...listeners]) listener();
};

const isTarget = (candidate: FlashTarget): boolean =>
  target !== null &&
  target.commentId === candidate.commentId &&
  target.surface === candidate.surface;

/** Points at one thread, on the surface the reviewer is looking at. */
export const flashThread = (next: FlashTarget): void => {
  if (clearTimer !== null) window.clearTimeout(clearTimer);
  target = next;
  announce();
  clearTimer = window.setTimeout(() => {
    target = null;
    clearTimer = null;
    announce();
  }, FLASH_MS);
};

/** Whether this drawing of this thread is the one being pointed at. */
export const useFlashedThread = (candidate: FlashTarget): boolean => {
  const [isFlashed, setIsFlashed] = useState(() => isTarget(candidate));
  const { commentId, surface } = candidate;
  useEffect(() => {
    const read = (): void => setIsFlashed(isTarget({ commentId, surface }));
    read();
    listeners.add(read);
    return () => {
      listeners.delete(read);
    };
  }, [commentId, surface]);
  return isFlashed;
};
