// Proves browser transport failures normalize to the runtime-unavailable
// identity while application failures retain their original meaning.

import { describe, expect, it } from "vitest";
import {
  isReviewRuntimeUnavailable,
  normalizeReviewRuntimeRequestError,
} from "./review-runtime-request.js";

describe("review runtime request errors", () => {
  it.each([
    { error: new TypeError("fetch failed"), timedOut: false },
    { error: new Error("aborted"), timedOut: true },
  ])("should classify transport failure as runtime unavailable", (input) => {
    expect(
      isReviewRuntimeUnavailable(normalizeReviewRuntimeRequestError(input)),
    ).toBe(true);
  });

  it("should preserve a reachable runtime application failure", () => {
    const error = new Error("Review runtime refused the request (500)");

    expect(normalizeReviewRuntimeRequestError({ error, timedOut: false })).toBe(
      error,
    );
  });
});
