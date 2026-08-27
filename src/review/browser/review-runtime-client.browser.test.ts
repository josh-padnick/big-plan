import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./review-runtime-client.browser.js";
import {
  INITIAL_REVIEW_POLL_HEALTH,
  reviewRuntimeIsDown,
  transitionReviewPollHealth,
} from "./review-poll-health.js";
import type { ReviewPollResult } from "./review-poll-health.js";
import {
  isReviewRuntimeUnavailable,
  reviewRuntimeRefusalStatus,
} from "./review-runtime-request.js";
import { reviewWriteAvailability } from "./review-write-availability.js";

const IDENTITY = {
  planId: "1111111111111111",
  sessionId: "abcdef0123456789",
  token: "review-token",
} as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The failure one poll of a runtime that answered this way ends with. */
const failedPoll = async (answer: Response): Promise<unknown> => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => answer),
  );
  vi.stubGlobal("window", { setTimeout: () => 1, clearTimeout: vi.fn() });
  return requestJson({ path: "/api/session", identity: IDENTITY }).then(
    () => undefined,
    (error: unknown) => error,
  );
};

// How the review controller reads one poll failure, and the only input the
// health state takes.
const pollResult = (error: unknown): ReviewPollResult =>
  isReviewRuntimeUnavailable(error) ? "runtime-unavailable" : "poll-failed";

/** The health two consecutive failures of this kind leave behind. */
const healthAfterTwo = (error: unknown) =>
  transitionReviewPollHealth({
    health: transitionReviewPollHealth({
      health: INITIAL_REVIEW_POLL_HEALTH,
      result: pollResult(error),
      nowMs: 1_000,
    }),
    result: pollResult(error),
    nowMs: 1_750,
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
        identity: IDENTITY,
      }),
    ).resolves.toEqual({ state: "ready" });
    expect(fetchRequest).toHaveBeenCalledWith(
      "api/session",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("should take a page down and lock writes when a hop reports nothing behind it", async () => {
    const error = await failedPoll(
      new Response("No live review session\n", {
        status: 502,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    );

    expect(isReviewRuntimeUnavailable(error)).toBe(true);
    const health = healthAfterTwo(error);
    expect(reviewRuntimeIsDown(health)).toBe(true);
    expect(
      reviewWriteAvailability({
        hasReviewSession: true,
        health,
        writesStalledMs: undefined,
        authoritative: true,
      }),
    ).toMatchObject({ state: "unavailable", block: "runtime-offline" });
  });

  it("should keep a runtime that reported its own stall answering and readable", async () => {
    const stalled =
      "This review session has stopped accepting changes. Restart the review runtime to continue.";
    const error = await failedPoll(
      new Response(JSON.stringify({ error: stalled }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(isReviewRuntimeUnavailable(error)).toBe(false);
    expect(reviewRuntimeRefusalStatus(error)).toBe(503);
    expect(error).toMatchObject({ message: stalled });
    expect(reviewRuntimeIsDown(healthAfterTwo(error))).toBe(false);
  });
});
