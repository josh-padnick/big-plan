// Keeps a post-swap restoration - the reader's scroll position, their text
// selection - in place while the swap's own re-renders try to undo it.
//
// A silent article swap sets off work on React's schedule, not on a fixed
// frame. The one that breaks the reader's place is a dialog remounting under
// the in-place refresh: it re-runs the "clear the selection on open" layout
// effect that wipes the range the swap just restored. That commit does not land
// on a predictable frame or even a single predictable commit - on a loaded
// machine it arrives a variable number of renders later - so a restore that
// fires once (on a frame count, a timer tick, or one post-commit effect) races
// it and loses. A one-shot restore was measured failing 14 of 40 runs under
// load for exactly this reason; re-pinning across the settle window holds.
//
// So this re-applies the restore across a short window until it holds, then
// stops. It bails the moment the reader takes over - a wheel, a touch, a key, a
// pointer press - so it never fights a deliberate scroll or a new selection; a
// programmatic scrollTo the restore itself makes is not one of those, so
// re-pinning does not cancel itself. It schedules on a timer rather than
// requestAnimationFrame because a frame is throttled for a page the OS treats
// as unfocused - which a Playwright page under a saturated runner effectively
// is - and a throttled frame is the very delay this defends against. Removing
// the dialog's spurious selection clear at its source (a filed follow-up) is
// what would let this convergence be retired.

// The gestures that mean the reader, not the swap, is now moving the page or
// the selection. A "scroll" event is deliberately not among them: the restore
// scrolls the page itself, and listening for that would cancel the defence the
// first time it did its job.
const READER_INTENT = [
  "wheel",
  "touchstart",
  "keydown",
  "pointerdown",
] as const;

// Re-pins promptly right after the swap - where the render that undoes it is
// most likely - and thins out toward the end, so the whole defence is a handful
// of ticks over roughly a second rather than a spin.
const RESTORE_SCHEDULE_MS = [16, 48, 112, 240, 496, 1008] as const;

/**
 * Re-applies `restore` until `isSettled` reports it held, the reader
 * intervenes, or the schedule runs out, and returns a canceller for a caller
 * whose own lifetime ends first (a component unmount, a newer swap). `restore`
 * runs only while `isSettled` is false, so a restoration that already stuck
 * costs nothing and a later re-render that undoes it is repaired on the next
 * tick. `onStop` runs once when the defence ends, however it ends - the place
 * to undo anything held only for its duration, such as suppressed scroll
 * anchoring.
 */
export const keepRestored = ({
  view,
  restore,
  isSettled,
  onStop,
}: {
  readonly view: Window;
  readonly restore: () => void;
  readonly isSettled: () => boolean;
  readonly onStop?: () => void;
}): (() => void) => {
  let stopped = false;
  const timers = new Set<number>();
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    for (const id of timers) view.clearTimeout(id);
    timers.clear();
    for (const type of READER_INTENT) view.removeEventListener(type, stop);
    onStop?.();
  };
  const reassert = (): void => {
    if (stopped || isSettled()) return;
    restore();
  };
  for (const type of READER_INTENT)
    view.addEventListener(type, stop, { passive: true });
  restore();
  for (const at of RESTORE_SCHEDULE_MS)
    timers.add(view.setTimeout(reassert, at));
  timers.add(
    view.setTimeout(stop, RESTORE_SCHEDULE_MS[RESTORE_SCHEDULE_MS.length - 1]),
  );
  return stop;
};
