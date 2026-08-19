// Proves browser transport failures and reachable runtime refusals retain
// distinct identities, including the runtime's refusal reason and status.

import { describe, expect, it } from "vitest";
import {
  isReviewRuntimeUnavailable,
  isTerminalReviewRuntimeRefusal,
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

  it("should keep a refusal a refusal when the timeout fires during the body read", async () => {
    const refusal = await reviewRuntimeRefusal({
      status: 409,
      readBody: () =>
        Promise.resolve({ error: "The plan no longer asks this." }),
    });

    expect(
      normalizeReviewRuntimeRequestError({ error: refusal, timedOut: true }),
    ).toBe(refusal);
    expect(
      isTerminalReviewRuntimeRefusal(
        normalizeReviewRuntimeRequestError({ error: refusal, timedOut: true }),
      ),
    ).toBe(true);
  });

  it.each([
    { status: 408, name: "a request timeout" },
    { status: 429, name: "too many requests" },
  ])("should keep $name retryable", async ({ status }) => {
    expect(
      isTerminalReviewRuntimeRefusal(
        await reviewRuntimeRefusal({
          status,
          readBody: () => Promise.resolve({}),
        }),
      ),
    ).toBe(false);
  });

  it.each([{ status: 409 }, { status: 425 }, { status: 400 }])(
    "should keep $status terminal",
    async ({ status }) => {
      expect(
        isTerminalReviewRuntimeRefusal(
          await reviewRuntimeRefusal({
            status,
            readBody: () => Promise.resolve({}),
          }),
        ),
      ).toBe(true);
    },
  );
});
