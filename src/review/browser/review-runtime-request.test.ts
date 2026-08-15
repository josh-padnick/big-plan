// Proves browser transport failures and reachable runtime refusals retain
// distinct identities, including the runtime's refusal reason and status.

import { describe, expect, it } from "vitest";
import {
  isReviewRuntimeUnavailable,
  normalizeReviewRuntimeRequestError,
  reviewRuntimeRefusal,
  reviewRuntimeRefusalStatus,
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

  it("should carry the runtime's own reason and status for a refusal", async () => {
    const refusal = await reviewRuntimeRefusal({
      status: 409,
      readBody: () =>
        Promise.resolve({ error: "This comment has a message waiting." }),
    });

    expect(refusal.message).toBe("This comment has a message waiting.");
    expect(reviewRuntimeRefusalStatus(refusal)).toBe(409);
  });

  it.each([
    { name: "an unreadable body", readBody: () => Promise.reject(new Error()) },
    { name: "a body with no reason", readBody: () => Promise.resolve({}) },
    { name: "an empty reason", readBody: () => Promise.resolve({ error: "" }) },
  ])("should fall back to the status alone for $name", async (input) => {
    const refusal = await reviewRuntimeRefusal({
      status: 500,
      readBody: input.readBody,
    });

    expect(refusal.message).toBe("Review runtime refused the request (500)");
  });

  it("should report no refusal status for an ordinary failure", () => {
    expect(reviewRuntimeRefusalStatus(new Error("boom"))).toBeUndefined();
  });
});
