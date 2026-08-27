import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./review-runtime-client.browser.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("review runtime requests", () => {
  it("should resolve an API route relative to the document address", async () => {
    const fetchRequest = vi.fn(
      async () =>
        new Response('{"state":"ready"}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchRequest);
    vi.stubGlobal("window", {
      setTimeout: () => 1,
      clearTimeout: vi.fn(),
    });

    await expect(
      requestJson({
        path: "/api/session",
        identity: {
          planId: "1111111111111111",
          sessionId: "abcdef0123456789",
          token: "review-token",
        },
      }),
    ).resolves.toEqual({ state: "ready" });
    expect(fetchRequest).toHaveBeenCalledWith(
      "api/session",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
