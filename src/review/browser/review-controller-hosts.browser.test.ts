import { describe, expect, it } from "vitest";
import { canMountReviewBlockHost } from "./review-controller-hosts.browser.js";

const blockWithClosest = (
  closest: (selector: string) => Element | null,
): HTMLElement =>
  ({
    closest,
  }) as unknown as HTMLElement;

describe("canMountReviewBlockHost", () => {
  it("rejects a baseline block under an inert ancestor", () => {
    const inertAncestor = {} as Element;
    const block = blockWithClosest((selector) =>
      selector === "[inert]" ? inertAncestor : null,
    );

    expect(canMountReviewBlockHost(block)).toBe(false);
  });

  it("accepts a baseline block inside a live-marked subtree", () => {
    const block = blockWithClosest(() => null);

    expect(canMountReviewBlockHost(block)).toBe(true);
  });
});
