import { describe, expect, it, vi } from "vitest";
import { keepRestored } from "./swap-restore.browser.js";

/**
 * A minimal stand-in for the view keepRestored drives: a hand-cranked timer
 * queue and event registry, so a test advances time and fires reader gestures
 * deterministically without a real DOM or wall clock.
 */
const makeView = () => {
  let nextId = 1;
  let now = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const listeners = new Map<string, Set<() => void>>();
  const view = {
    setTimeout: (fn: () => void, ms: number): number => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: number): void => {
      timers.delete(id);
    },
    addEventListener: (type: string, cb: () => void): void => {
      const set = listeners.get(type) ?? new Set();
      set.add(cb);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, cb: () => void): void => {
      listeners.get(type)?.delete(cb);
    },
    advance: (ms: number): void => {
      now += ms;
      for (const [id, timer] of [...timers].sort(
        (left, right) => left[1].at - right[1].at,
      )) {
        if (timer.at > now) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    fire: (type: string): void => {
      for (const cb of [...(listeners.get(type) ?? [])]) cb();
    },
    listenerCount: (type: string): number => listeners.get(type)?.size ?? 0,
  };
  return view;
};

const start = (
  view: ReturnType<typeof makeView>,
  options: {
    readonly restore: () => void;
    readonly isSettled: () => boolean;
    readonly onStop?: () => void;
  },
): (() => void) =>
  keepRestored({ view: view as unknown as Window, ...options });

describe("keepRestored", () => {
  it("re-applies the restore across the window while it has not settled", () => {
    const view = makeView();
    const restore = vi.fn();
    start(view, { restore, isSettled: () => false });
    // The synchronous first apply, then one per scheduled tick as long as the
    // restoration keeps failing to hold.
    expect(restore).toHaveBeenCalledTimes(1);
    view.advance(2_000);
    expect(restore.mock.calls.length).toBeGreaterThan(1);
  });

  it("stops re-applying once the restoration holds", () => {
    const view = makeView();
    let settled = false;
    const restore = vi.fn(() => {
      settled = true;
    });
    start(view, { restore, isSettled: () => settled });
    view.advance(2_000);
    // The first apply made it hold; every later tick saw a settled state and
    // did nothing.
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("repairs a restoration a later re-render undoes", () => {
    const view = makeView();
    let settled = true;
    const restore = vi.fn(() => {
      settled = true;
    });
    start(view, { restore, isSettled: () => settled });
    restore.mockClear();
    // A re-render clears it mid-window; the next tick must put it back.
    settled = false;
    view.advance(2_000);
    expect(restore).toHaveBeenCalled();
  });

  it("yields to the reader and unwinds once when a gesture arrives", () => {
    const view = makeView();
    const restore = vi.fn();
    const onStop = vi.fn();
    start(view, { restore, isSettled: () => false, onStop });
    const before = restore.mock.calls.length;
    view.fire("wheel");
    expect(onStop).toHaveBeenCalledTimes(1);
    view.advance(2_000);
    // No further re-pin after the reader took over, and every listener is gone.
    expect(restore).toHaveBeenCalledTimes(before);
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"])
      expect(view.listenerCount(type)).toBe(0);
  });

  it("runs onStop exactly once when the window closes on its own", () => {
    const view = makeView();
    const onStop = vi.fn();
    start(view, { restore: vi.fn(), isSettled: () => false, onStop });
    view.advance(2_000);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("stops and unwinds once when the caller cancels", () => {
    const view = makeView();
    const restore = vi.fn();
    const onStop = vi.fn();
    const cancel = start(view, { restore, isSettled: () => false, onStop });
    cancel();
    cancel();
    expect(onStop).toHaveBeenCalledTimes(1);
    const after = restore.mock.calls.length;
    view.advance(2_000);
    expect(restore).toHaveBeenCalledTimes(after);
  });
});
