// Proves an anchored alert hangs below its control and stays on screen.

import { describe, expect, it } from "vitest";
import { placeAnchoredDialog } from "./alert-dialog-position.js";

describe("placeAnchoredDialog", () => {
  it("should hang the panel below a top-right control and right-align to it", () => {
    expect(
      placeAnchoredDialog({
        anchor: { top: 8, right: 1260, bottom: 40, left: 1180 },
        viewport: { width: 1280, height: 800 },
        preferredWidth: 672,
      }),
    ).toEqual({
      top: 48,
      right: 20,
      maxHeight: 740,
      maxWidth: 672,
    });
  });

  it("should shrink the panel when the viewport is narrower than the preferred width", () => {
    expect(
      placeAnchoredDialog({
        anchor: { top: 8, right: 378, bottom: 40, left: 300 },
        viewport: { width: 390, height: 844 },
        preferredWidth: 672,
      }),
    ).toEqual({
      top: 48,
      right: 12,
      maxHeight: 784,
      maxWidth: 366,
    });
  });

  it("should keep the panel on screen when the control sits at the viewport edge", () => {
    expect(
      placeAnchoredDialog({
        anchor: { top: 0, right: 390, bottom: 32, left: 310 },
        viewport: { width: 390, height: 844 },
        preferredWidth: 672,
      }).right,
    ).toBe(12);
  });
});
