// Proves portaled tooltips choose visible viewport space and expose a bounded
// height for long content.

import { describe, expect, it } from "vitest";
import { placeTooltip, resolveRemMeasure } from "./tooltip-position.js";

const VIEWPORT = { width: 320, height: 640 };
const LABEL_WIDTH = 11 * 16;
const EXPLANATION_WIDTH = 17 * 16;

describe("tooltip position", () => {
  it("should place a top-edge tooltip below its anchor", () => {
    expect(
      placeTooltip({
        anchor: { top: 20, right: 180, bottom: 44, left: 140 },
        viewport: VIEWPORT,
        maxWidth: LABEL_WIDTH,
      }),
    ).toMatchObject({ placement: "below", top: 52, maxHeight: 580 });
  });

  it("should place a bottom-edge tooltip above its anchor", () => {
    expect(
      placeTooltip({
        anchor: { top: 580, right: 180, bottom: 604, left: 140 },
        viewport: VIEWPORT,
        maxWidth: LABEL_WIDTH,
      }),
    ).toMatchObject({ placement: "above", top: 572, maxHeight: 564 });
  });

  it("should flip a preferred-below tooltip above a bottom-edge anchor", () => {
    expect(
      placeTooltip({
        anchor: { top: 580, right: 180, bottom: 604, left: 140 },
        viewport: VIEWPORT,
        preferredPlacement: "below",
        maxWidth: LABEL_WIDTH,
      }),
    ).toMatchObject({ placement: "above", top: 572, maxHeight: 564 });
  });

  it("should keep a wide anchor tooltip inside narrow horizontal edges", () => {
    expect(
      placeTooltip({
        anchor: { top: 300, right: 20, bottom: 324, left: 0 },
        viewport: VIEWPORT,
        maxWidth: LABEL_WIDTH,
      }).left,
    ).toBe(96);
  });

  it("should resolve a rem measure against the reader's own root size", () => {
    expect(resolveRemMeasure(17, "16px")).toBe(272);
    expect(resolveRemMeasure(17, "20px")).toBe(340);
  });

  it("should fall back to a usable root size rather than resolving to NaN", () => {
    // A NaN measure would place the tooltip nowhere, which reads as the help
    // silently not working rather than as a fault.
    expect(resolveRemMeasure(17, "")).toBe(272);
    expect(resolveRemMeasure(17, undefined)).toBe(272);
    expect(resolveRemMeasure(17, "0px")).toBe(272);
  });

  it("should widen the clamp with a larger root font size", () => {
    // The measure is authored in rem, so a reader whose browser default is
    // larger gets a wider tooltip; the clamp has to follow it or the far edge
    // leaves the viewport.
    const anchor = { top: 300, right: 1_420, bottom: 324, left: 1_400 };
    const viewport = { width: 1_440, height: 900 };
    expect(
      placeTooltip({
        anchor,
        viewport,
        maxWidth: resolveRemMeasure(17, "20px"),
      }).left,
    ).toBe(1_440 - (340 / 2 + 8));
  });

  it("should clamp a wide tooltip against its own measure, not the label measure", () => {
    expect(
      placeTooltip({
        anchor: { top: 300, right: 1_420, bottom: 324, left: 1_400 },
        viewport: { width: 1_440, height: 900 },
        maxWidth: EXPLANATION_WIDTH,
      }).left,
    ).toBe(1_440 - (EXPLANATION_WIDTH / 2 + 8));
  });
});
