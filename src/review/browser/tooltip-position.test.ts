// Proves portaled tooltips choose visible viewport space and expose a bounded
// height for long content.

import { describe, expect, it } from "vitest";
import { placeTooltip } from "./tooltip-position.js";

const VIEWPORT = { width: 320, height: 640 };

describe("tooltip position", () => {
  it("should place a top-edge tooltip below its anchor", () => {
    expect(
      placeTooltip({
        anchor: { top: 20, right: 180, bottom: 44, left: 140 },
        viewport: VIEWPORT,
      }),
    ).toMatchObject({ placement: "below", top: 52, maxHeight: 580 });
  });

  it("should place a bottom-edge tooltip above its anchor", () => {
    expect(
      placeTooltip({
        anchor: { top: 580, right: 180, bottom: 604, left: 140 },
        viewport: VIEWPORT,
      }),
    ).toMatchObject({ placement: "above", top: 572, maxHeight: 564 });
  });

  it("should keep a wide anchor tooltip inside narrow horizontal edges", () => {
    expect(
      placeTooltip({
        anchor: { top: 300, right: 20, bottom: 324, left: 0 },
        viewport: VIEWPORT,
      }).left,
    ).toBe(96);
  });
});
