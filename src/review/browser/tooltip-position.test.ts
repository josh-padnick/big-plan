// Proves portaled tooltips choose visible viewport space and expose a bounded
// height for long content.

import { describe, expect, it } from "vitest";
import { placeTooltip } from "./tooltip-position.js";

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
