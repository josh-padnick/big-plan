// Guards the one property the fit's own source cannot state for itself: the
// viewer script embeds it through `.toString()`, so anything it names that
// lives outside its body is undefined in the browser. That failure is silent
// in a review document - the frame simply keeps the zoom it already had - so
// it is caught here instead, by re-evaluating the stringified source in
// isolation and driving it through a maximized fit.

import { describe, expect, it } from "vitest";
import { fitWireframeScreen } from "./wireframe-fit.js";

// The fit reads geometry and computed style and writes zoom and width. This
// is the smallest DOM that answers all of it: a maximized 1200-wide frame
// inside a 600-wide, 500-tall screen box, with a caption whose height grows
// as its width shrinks - the circularity the pass loop exists to resolve.
const FRAME_WIDTH = 1200;
const FRAME_HEIGHT = 820;
const SCREEN_WIDTH = 600;
const SCREEN_HEIGHT = 500;
const CARD_INSET = 18;

type Styles = Record<string, string>;

const evaluateEmbeddedSource = (): ((screen: unknown) => void) =>
  Function(`"use strict"; return (${fitWireframeScreen.toString()});`)() as (
    screen: unknown,
  ) => void;

const buildScreen = ({ maximized }: { readonly maximized: boolean }) => {
  const styles = new Map<object, Styles>();
  const zeroInset: Styles = {
    paddingLeft: "0px",
    paddingRight: "0px",
    paddingTop: "0px",
    paddingBottom: "0px",
    marginTop: "0px",
    marginBottom: "0px",
    borderLeftWidth: "0px",
    borderRightWidth: "0px",
    borderTopWidth: "0px",
    borderBottomWidth: "0px",
  };
  const frame = {
    style: { zoom: "1" },
    offsetWidth: FRAME_WIDTH,
    offsetHeight: FRAME_HEIGHT,
  };
  const card = {
    style: { width: "" },
    querySelector: () => frame,
  };
  const caption = {
    style: { width: "" },
    // A narrower caption wraps onto more lines: 14 characters per 100px of
    // width, at a 20px line, over a 40-character name.
    getBoundingClientRect: () => {
      const width = Number.parseFloat(caption.style.width);
      const lines = Number.isNaN(width)
        ? 1
        : Math.max(1, Math.ceil(40 / Math.max(1, (width / 100) * 14)));
      return { height: lines * 20 + 20 };
    },
  };
  const screen = {
    clientWidth: SCREEN_WIDTH,
    clientHeight: SCREEN_HEIGHT,
    querySelector: (selector: string) =>
      selector.includes("frame-card") ? card : caption,
    closest: () => (maximized ? {} : null),
  };
  styles.set(screen, zeroInset);
  styles.set(caption, zeroInset);
  styles.set(card, {
    ...zeroInset,
    paddingLeft: "8px",
    paddingRight: "8px",
    paddingTop: "8px",
    paddingBottom: "8px",
    borderLeftWidth: "1px",
    borderRightWidth: "1px",
    borderTopWidth: "1px",
    borderBottomWidth: "1px",
  });
  return { card, caption, frame, screen, styles };
};

const withComputedStyle = <T>(styles: Map<object, Styles>, run: () => T): T => {
  const globals = globalThis as unknown as {
    getComputedStyle?: (node: object) => Styles;
  };
  const previous = globals.getComputedStyle;
  globals.getComputedStyle = (node) => styles.get(node) ?? {};
  try {
    return run();
  } finally {
    globals.getComputedStyle = previous;
  }
};

describe("fitWireframeScreen", () => {
  it("should survive being embedded as text with no surrounding module", () => {
    const embedded = evaluateEmbeddedSource();
    const { card, caption, frame, screen, styles } = buildScreen({
      maximized: true,
    });

    withComputedStyle(styles, () => {
      embedded(screen);
    });

    const scale = Number.parseFloat(frame.style.zoom);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThan(1);
    // The frame plus the caption it must leave room for fit the screen box.
    const captionHeight = caption.getBoundingClientRect().height;
    expect(
      FRAME_HEIGHT * scale + captionHeight + CARD_INSET,
    ).toBeLessThanOrEqual(SCREEN_HEIGHT + 1);
    // The card and the caption are pinned to the width the frame paints at,
    // which is what keeps a long caption aligned with the drawing it names.
    const paintedWidth = `${String(FRAME_WIDTH * scale + CARD_INSET)}px`;
    expect(card.style.width).toBe(paintedWidth);
    expect(caption.style.width).toBe(paintedWidth);
  });

  it("should fit width only at rest, leaving the drawing at its true height", () => {
    const { frame, screen, styles } = buildScreen({ maximized: false });

    withComputedStyle(styles, () => {
      fitWireframeScreen(screen as unknown as HTMLElement);
    });

    expect(Number.parseFloat(frame.style.zoom)).toBeCloseTo(
      (SCREEN_WIDTH - CARD_INSET) / FRAME_WIDTH,
      5,
    );
  });
});
