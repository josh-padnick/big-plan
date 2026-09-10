// Proves which browser resource failures render health treats as runtime backpressure.

import { describe, expect, it } from "vitest";
import { isRuntimeBackpressureError } from "./render-health.js";

const SERVICE_UNAVAILABLE =
  "Failed to load resource: the server responded with a status of 503 (Service Unavailable)";

describe("isRuntimeBackpressureError", () => {
  it("should ignore runtime backpressure from a same-origin API route", () => {
    expect(
      isRuntimeBackpressureError({
        text: SERVICE_UNAVAILABLE,
        locationUrl: "http://127.0.0.1:4173/plan/1111111111111111/api/drafts",
        pageUrl: "http://127.0.0.1:4173/plan/1111111111111111/",
      }),
    ).toBe(true);
  });

  it("should ignore runtime backpressure when the review is served at root", () => {
    expect(
      isRuntimeBackpressureError({
        text: SERVICE_UNAVAILABLE,
        locationUrl: "http://127.0.0.1:4173/api/input-contract",
        pageUrl: "http://127.0.0.1:4173/",
      }),
    ).toBe(true);
  });

  it("should preserve render-health failures from a cross-origin API route", () => {
    expect(
      isRuntimeBackpressureError({
        text: SERVICE_UNAVAILABLE,
        locationUrl: "https://example.test/api/image",
        pageUrl: "http://127.0.0.1:4173/plan/1111111111111111/",
      }),
    ).toBe(false);
  });

  it("should preserve same-origin failures outside the API path boundary", () => {
    expect(
      isRuntimeBackpressureError({
        text: SERVICE_UNAVAILABLE,
        locationUrl: "http://127.0.0.1:4173/assets/api/image",
        pageUrl: "http://127.0.0.1:4173/plan/1111111111111111/",
      }),
    ).toBe(false);
  });

  it("should preserve an API failure belonging to a different plan", () => {
    expect(
      isRuntimeBackpressureError({
        text: SERVICE_UNAVAILABLE,
        locationUrl: "http://127.0.0.1:4173/plan/2222222222222222/api/drafts",
        pageUrl: "http://127.0.0.1:4173/plan/1111111111111111/",
      }),
    ).toBe(false);
  });
});
