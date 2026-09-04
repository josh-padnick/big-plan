// Proves the one rule that decides whether undoing a verdict takes the reader
// back to the change it reopened.

import { describe, expect, it } from "vitest";
import { NO_REVEAL_HONOURED, shouldHonourReveal } from "./lens-reveal.js";

const honour = (
  overrides: Partial<Parameters<typeof shouldHonourReveal>[0]> = {},
): boolean =>
  shouldHonourReveal({
    revealKey: 1,
    honoured: NO_REVEAL_HONOURED,
    hasHost: true,
    ...overrides,
  });

describe("shouldHonourReveal", () => {
  it("owes nothing until a reveal is asked for", () => {
    expect(honour({ revealKey: NO_REVEAL_HONOURED })).toBe(false);
  });

  it("takes the reader to a change a reveal asked for", () => {
    expect(honour()).toBe(true);
  });

  it("owes the same reveal only once, however often the lens re-renders", () => {
    expect(honour({ honoured: 1 })).toBe(false);
  });

  it("keeps owing while the lens has nowhere to stand", () => {
    // Undoing a rejection puts bytes back, so the ask arrives before the lens
    // has a host. It has to survive that, or the reader is left where they
    // were with the change they reopened somewhere off screen.
    expect(honour({ hasHost: false })).toBe(false);
    expect(honour({ hasHost: true })).toBe(true);
  });

  it("owes a later reveal even after an earlier one was honoured", () => {
    expect(honour({ revealKey: 2, honoured: 1 })).toBe(true);
  });
});
