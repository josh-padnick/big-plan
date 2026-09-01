import { describe, expect, it } from "vitest";
import { DIFF_SCROLL_GAP, diffScrollTarget } from "./diff-scroll.js";

const frame = {
  cardTop: 1000,
  cardHeight: 400,
  readingTop: 44,
  floorTop: 869,
  maxScroll: 5000,
};

describe("diffScrollTarget", () => {
  it("should finish a change that fits just above the stepper", () => {
    const target = diffScrollTarget(frame);
    const cardBottomOnScreen = frame.cardTop + frame.cardHeight - target;
    expect(cardBottomOnScreen).toBe(frame.floorTop - DIFF_SCROLL_GAP);
    // Both ends are readable, which is the whole point of the position.
    expect(frame.cardTop - target).toBeGreaterThanOrEqual(frame.readingTop);
  });

  it("should open a change too tall to fit at its own beginning", () => {
    // A card taller than the room between the header and the stepper cannot
    // show both ends, so the reader is put at the end reading starts from.
    const target = diffScrollTarget({ ...frame, cardHeight: 2000 });
    expect(frame.cardTop - target).toBe(frame.readingTop + DIFF_SCROLL_GAP);
  });

  it("should open at the top when the stepper leaves no room at all", () => {
    const target = diffScrollTarget({ ...frame, floorTop: frame.readingTop });
    expect(frame.cardTop - target).toBe(frame.readingTop + DIFF_SCROLL_GAP);
  });

  it("should not scroll above the document or past its end", () => {
    expect(diffScrollTarget({ ...frame, cardTop: 0, cardHeight: 40 })).toBe(0);
    expect(
      diffScrollTarget({ ...frame, cardTop: 9000, maxScroll: 5000 }),
    ).toBe(5000);
  });
});
